// Structured logs: [MARKET] [ANALYSIS] [SIGNAL] [AI] [CRITIC] [FINAL]. Never log secrets.
type Level = 'MARKET' | 'ANALYSIS' | 'SIGNAL' | 'AI' | 'CRITIC' | 'FINAL' | 'RISK' | 'ERROR' | 'SCREEN';

export function log(level: Level, message: string, data?: unknown): void {
  const line = `[${level}] ${message}`;
  if (data !== undefined) {
    console.log(line, data);
  } else {
    console.log(line);
  }
}
