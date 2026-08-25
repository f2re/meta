export const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function safeUuid(value, label = "идентификатор") {
  const id = String(value || "");
  if (!UUID_V4_PATTERN.test(id)) {
    throw Object.assign(new Error(`Некорректный ${label}.`), { statusCode: 400 });
  }
  return id;
}
