"""
Dolu veritabanında yükseltme provası için GENEL TOHUMLAYICI (gece-4 S10-10, 10-18).

Kullanım (YALNIZ yerel / atılabilir bir PostgreSQL — ASLA canlı adres; gerçek veri YOK, değerler yapay):
  1. Boş bir veritabanına canlının migration seviyesine kadar uygula (ör. 00..58 kopyalanmış bir klasörle `prisma migrate deploy`).
  2. python3 -I scripts/ops-migration-rehearsal-seed.py <veritabanı> [satır_sayısı=40] [port=5441] [host=127.0.0.1]
     → her tabloya yabancı anahtar sırasıyla N satır; zorunlu kolonlar tipine göre, isteğe bağlı yabancı anahtarlar da bağlanır.
  3. Kalan migration'ları aynı veritabanına uygula; ardından `prisma migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma`
     boş migration vermeli.
10-18 ölçümü: 58 durumunda 37 tablo × 40 satır → 59..77 hatasız (1,5 sn), sapma sıfır.
"""
import json, subprocess, sys
DB = sys.argv[1]
N = int(sys.argv[2]) if len(sys.argv) > 2 else 40
PORT = sys.argv[3] if len(sys.argv) > 3 else "5441"
HOST = sys.argv[4] if len(sys.argv) > 4 else "127.0.0.1"
if HOST not in ("127.0.0.1", "localhost") and not HOST.startswith("/"):
    sys.exit("Yalnız yerel PostgreSQL (127.0.0.1 / localhost / soket klasörü) — prova aracı uzak veritabanına yazmaz.")
def q(sql):
    r = subprocess.run(["psql", "-h", HOST, "-p", PORT, "-U", "postgres", "-d", DB, "-v", "ON_ERROR_STOP=1", "-tAc", sql], capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError(r.stderr.strip()[:400])
    return r.stdout.strip()
tables = [t for t in q("select tablename from pg_tables where schemaname='public' and tablename<>'_prisma_migrations'").split("\n") if t]
cols = json.loads(q("""select coalesce(json_agg(json_build_object('t',table_name,'c',column_name,'type',data_type,'udt',udt_name,'null',is_nullable,'def',column_default)),'[]') from information_schema.columns where table_schema='public'"""))
fks = json.loads(q("""select coalesce(json_agg(json_build_object('t',cl.relname,'c',a.attname,'rt',rc.relname,'rc',ra.attname)),'[]')
 from pg_constraint co join pg_class cl on cl.oid=co.conrelid join pg_class rc on rc.oid=co.confrelid
 join pg_attribute a on a.attrelid=co.conrelid and a.attnum=co.conkey[1] join pg_attribute ra on ra.attrelid=co.confrelid and ra.attnum=co.confkey[1]
 where co.contype='f' and array_length(co.conkey,1)=1"""))
fk = {(f["t"], f["c"]): (f["rt"], f["rc"]) for f in fks}
deps = {t: {f["rt"] for f in fks if f["t"] == t and f["rt"] != t} for t in tables}
order, seen = [], set()
def visit(t, stack=()):
    if t in seen or t in stack: return
    for d in deps.get(t, ()): visit(d, stack + (t,))
    seen.add(t); order.append(t)
for t in tables: visit(t)
ids = {}
def val(t, c, i):
    if (t, c["c"]) in fk:
        rt, rc = fk[(t, c["c"])]
        pool = ids.get((rt, rc)) or []
        if not pool: return None
        return "'" + pool[i % len(pool)].replace("'", "''") + "'"
    ty, udt = c["type"], c["udt"]
    if ty in ("text", "character varying"): return f"'{t[:6]}-{c['c'][:10]}-{i}'"
    if ty in ("integer", "bigint", "smallint"): return str(i + 1)
    if ty in ("double precision", "numeric", "real"): return "1"
    if ty == "boolean": return "false"
    if ty.startswith("timestamp") or ty == "date": return f"now() - interval '{i} hours'"
    if ty in ("jsonb", "json"): return "'{}'"
    if ty == "ARRAY": return "'{}'"
    if ty == "bytea": return "'\\x00'"
    if ty == "USER-DEFINED":
        lab = q(f"select enumlabel from pg_enum e join pg_type ty on ty.oid=e.enumtypid where ty.typname='{udt}' order by enumsortorder limit 1")
        return f"'{lab}'"
    return f"'{i}'"
counts = {}
for t in order:
    tcols = [c for c in cols if c["t"] == t]
    must = [c for c in tcols if c["null"] == "NO" and c["def"] is None]
    # Sık kullanılan isteğe bağlı FK'ler de doldurulur (gerçekçi bağ: konuşma ↔ rezervasyon, görev ↔ rezervasyon, mesaj ↔ konuşma).
    opt_fk = [c for c in tcols if c["null"] == "YES" and (t, c["c"]) in fk]
    ok = 0
    for i in range(N):
        names, vals = [], []
        skip = False
        for c in must + opt_fk:
            v = val(t, c, i)
            if v is None:
                if c in must: skip = True; break
                continue
            names.append('"' + c["c"] + '"'); vals.append(v)
        if skip: break
        try:
            q(f'insert into "{t}" ({", ".join(names)}) values ({", ".join(vals)})' if names else f'insert into "{t}" default values')
            ok += 1
        except RuntimeError as e:
            if i == 0: print(f"! {t}: {str(e)[:160]}")
            continue
    counts[t] = ok
    pk = [c["c"] for c in tcols if c["c"] == "id"]
    if pk: ids[(t, "id")] = [x for x in q(f'select "id"::text from "{t}"').split("\n") if x]
    for (ft, fc), (rt, rc) in fk.items():
        if rt == t and rc != "id": ids[(t, rc)] = [x for x in q(f'select "{rc}"::text from "{t}"').split("\n") if x]
print(json.dumps({k: v for k, v in sorted(counts.items())}, ensure_ascii=False))
print("tables:", len(tables), "seeded:", sum(1 for v in counts.values() if v > 0), "rows:", sum(counts.values()))
