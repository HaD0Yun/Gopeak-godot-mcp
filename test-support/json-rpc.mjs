export function parseJsonLines(data) {
  return data
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function parseTextContent(response) {
  const text = response?.result?.content?.map((chunk) => chunk?.text || '').join('') || '';
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function findJsonRpcResponse(data, id) {
  return parseJsonLines(data).find((message) => message?.id === id) ?? null;
}
