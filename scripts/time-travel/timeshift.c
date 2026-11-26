// Saat kaydırma pulu (LD_PRELOAD): gerçek zaman saatini TIMESHIFT_SECONDS kadar ileri / geri gösterir. Tekdüze saat (CLOCK_MONOTONIC —
// zamanlayıcılar, süre ölçümü) DEĞİŞMEZ. Alt süreçler (PostgreSQL dahil) ortamı devraldığı için aynı kaymayı görür.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdlib.h>
#include <sys/time.h>
#include <time.h>

static long long offset_sec(void) {
  static int init = 0;
  static long long off = 0;
  if (!init) {
    const char *v = getenv("TIMESHIFT_SECONDS");
    off = v ? atoll(v) : 0;
    init = 1;
  }
  return off;
}

int clock_gettime(clockid_t id, struct timespec *ts) {
  static int (*real)(clockid_t, struct timespec *) = 0;
  if (!real) real = dlsym(RTLD_NEXT, "clock_gettime");
  int r = real(id, ts);
  if (r == 0 && ts && (id == CLOCK_REALTIME || id == CLOCK_REALTIME_COARSE)) ts->tv_sec += offset_sec();
  return r;
}

int gettimeofday(struct timeval *tv, void *tz) {
  static int (*real)(struct timeval *, void *) = 0;
  if (!real) real = dlsym(RTLD_NEXT, "gettimeofday");
  int r = real(tv, tz);
  if (r == 0 && tv) tv->tv_sec += offset_sec();
  return r;
}

time_t time(time_t *t) {
  static time_t (*real)(time_t *) = 0;
  if (!real) real = dlsym(RTLD_NEXT, "time");
  time_t r = real(0) + offset_sec();
  if (t) *t = r;
  return r;
}
