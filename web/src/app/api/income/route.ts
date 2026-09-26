// Yearly income from a Capital One Nessie (sandbox) account's payroll deposits, plus the
// NYC landlord 40x rule: annual income must be at least 40x the monthly rent.
// GET /api/income?customer=<nessie customer id>
const API = "https://api.nessieisreal.com";

type Account = { _id: string; type: string };
type Deposit = { amount: number; transaction_date: string; description?: string; status?: string };

async function nessie<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}?key=${process.env.NESSIE_API_KEY}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`nessie ${res.status}`);
  return res.json();
}

export async function GET(request: Request) {
  const customer = new URL(request.url).searchParams.get("customer") ?? "";
  if (!/^[a-f0-9]{24}$/.test(customer)) return Response.json({ error: "bad customer id" }, { status: 400 });
  if (!process.env.NESSIE_API_KEY) return Response.json({ error: "NESSIE_API_KEY not set" }, { status: 503 });

  try {
    const accounts = await nessie<Account[]>(`/customers/${customer}/accounts`);
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const deposits = (await Promise.all(accounts.map((a) => nessie<Deposit[]>(`/accounts/${a._id}/deposits`)))).flat();
    const payroll = deposits.filter((d) =>
      new Date(d.transaction_date) >= cutoff && /payroll|salary|direct dep/i.test(d.description ?? ""));
    const annualIncome = Math.round(payroll.reduce((s, d) => s + d.amount, 0));
    return Response.json({
      source: "nessie",
      annualIncome,
      paychecks: payroll.length,
      maxRent40x: Math.floor(annualIncome / 40), // highest monthly rent a landlord would approve
      hourlyPay: Math.round((annualIncome / 2080) * 100) / 100,
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}
