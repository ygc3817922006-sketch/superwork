export async function singleFlight(flights, key, task) {
  const current = flights.get(key);
  if (current) return current;
  const promise = Promise.resolve().then(task);
  flights.set(key, promise);
  try {
    return await promise;
  } finally {
    if (flights.get(key) === promise) flights.delete(key);
  }
}
