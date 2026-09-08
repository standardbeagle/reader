export class ApiError extends Error {
  constructor(message: string, public code: string | null, public status: number) { super(message); }
}
