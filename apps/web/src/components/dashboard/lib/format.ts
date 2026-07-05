const countFormatter = new Intl.NumberFormat();
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  timeStyle: "short",
});

export function formatCount(value: number): string {
  return countFormatter.format(value);
}

export function formatDate(input: string): string {
  return dateFormatter.format(new Date(input));
}

export function formatDateTime(input: string): string {
  return dateTimeFormatter.format(new Date(input));
}

export function formatTime(input: string): string {
  return timeFormatter.format(new Date(input));
}
