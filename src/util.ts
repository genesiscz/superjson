export function forEach<T>(
  record: Record<string, T>,
  run: (v: T, key: string) => void
) {
  const keys = Object.keys(record);
  for (let i = 0; i < keys.length; i++) {
    run(record[keys[i]], keys[i]);
  }
}

export function includes<T>(arr: T[], value: T) {
  return arr.indexOf(value) !== -1;
}
