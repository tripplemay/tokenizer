const SERIALIZATION_FAILURE_CODE = "P2034";
const MAX_SERIALIZABLE_ATTEMPTS = 3;

function isSerializationFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === SERIALIZATION_FAILURE_CODE
  );
}

/** Retries only PostgreSQL serialization conflicts; all other failures stay visible. */
export async function retrySerializableTransaction<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializationFailure(error) || attempt === MAX_SERIALIZABLE_ATTEMPTS) throw error;
    }
  }

  throw new Error("unreachable");
}
