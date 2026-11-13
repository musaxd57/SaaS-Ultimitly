import { fireEvent, screen, within } from "@testing-library/react";

// Ödeme kartındaki onay kutularının hepsini işaretler (kurucu 11-13: ayrı açık onaylar; kartla deneme yolunda iki, normal yolda üç kutu).
export async function checkAllCheckoutConsents(): Promise<HTMLInputElement[]> {
  const group = await screen.findByRole("group", { name: "Ödeme öncesi onaylar" });
  const boxes = within(group).getAllByRole("checkbox") as HTMLInputElement[];
  for (const box of boxes) fireEvent.click(box);
  return boxes;
}
