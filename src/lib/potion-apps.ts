const KEY = "potion-apps";

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(list)) return [];
    return list.filter((n): n is string => typeof n === "string" && n.trim().length > 0);
  } catch {
    return [];
  }
}

function write(names: string[]) {
  localStorage.setItem(KEY, JSON.stringify(names));
}

export function listAppNames() {
  return read();
}

export function addAppName(raw: string) {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Type a name");
  const list = read();
  if (list.some((n) => n.toLowerCase() === name.toLowerCase())) return name;
  write([...list, name]);
  return name;
}

export function removeAppName(name: string) {
  write(read().filter((n) => n !== name));
}
