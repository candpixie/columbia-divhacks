// True monthly cost of living somewhere: rent + fares + the value of your commute time.

export const FARE_30_DAY = 132; // MTA 30-day unlimited
export const WEEKS_PER_MONTH = 4.33;
// US DOT values local personal travel time at 50% of hourly wage.
export const TIME_VALUE_SHARE = 0.5;

export type CostInput = {
  rentShare: number; // this person's monthly share
  weekdayMin: number; // one-way
  saturdayMin: number; // one-way
  annualIncome: number;
};

export type CostBreakdown = {
  rent: number;
  fare: number;
  hoursPerWeek: number;
  timeValue: number; // $/month
  total: number;
};

// 5 weekday round trips + 1 Saturday round trip per week
export function trueCost(c: CostInput): CostBreakdown {
  const minutesPerWeek = 5 * 2 * c.weekdayMin + 2 * c.saturdayMin;
  const hoursPerWeek = minutesPerWeek / 60;
  const hourly = (c.annualIncome / 2080) * TIME_VALUE_SHARE;
  const timeValue = hoursPerWeek * WEEKS_PER_MONTH * hourly;
  const total = c.rentShare + FARE_30_DAY + timeValue;
  return { rent: c.rentShare, fare: FARE_30_DAY, hoursPerWeek, timeValue, total };
}

// Landlords in NYC usually want annual income >= 40x the monthly rent.
export const incomeFromBudget = (monthlyBudget: number) => monthlyBudget * 40;
export const passes40x = (annualIncome: number, monthlyRent: number) => annualIncome >= 40 * monthlyRent;

// Split a unit's rent in proportion to each person's budget.
export function splitRent(unitRent: number, budgets: number[]): number[] {
  const total = budgets.reduce((a, b) => a + b, 0);
  return budgets.map((b) => Math.round((unitRent * b) / total));
}
