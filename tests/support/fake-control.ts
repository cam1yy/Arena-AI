/** Lets tests trigger failures in the fake services server started by global setup. */
export async function failNext(status: number, times = 1) {
  await fetch(`${process.env.LOCALY_FAKE_SERVICES_URL}/__control/fail?status=${status}&times=${times}`, { method: 'POST' });
}
