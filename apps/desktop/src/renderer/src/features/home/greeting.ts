/** "Good morning, Neel": by local hour, with the name omitted when unknown. */
export function greeting(now: number, name: string): string {
  const h = new Date(now).getHours();
  const part = h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name.trim() ? `${part}, ${name.trim()}` : part;
}
