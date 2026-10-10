type Fields = Record<string, unknown>;
const emit = (level: string, msg: string, f?: Fields) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...f }, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

export const log = {
  info: (msg: string, f?: Fields) => emit("info", msg, f),
  warn: (msg: string, f?: Fields) => emit("warn", msg, f),
  error: (msg: string, f?: Fields) => emit("error", msg, f),
};
export type Logger = typeof log;
