// Offline copy of the structured tables. Visibility rules mirror the RLS policies in
// backend/migrations/003_security.sql (student_row_visible, fee_row_visible, employees_secure).

import { PERSONAS } from "./personas";
import type { User } from "./types";

export type RecordKind = "students" | "fees" | "employees";
export type Row = Record<string, string | number | null>;

const DEPTS = ["CSE", "MECH", "CIVIL", "EC"] as const;
const FEE: Record<string, number> = { CSE: 135000, EC: 125000, MECH: 115000, CIVIL: 110000 };
const FIRST = ["Aarav", "Diya", "Vivaan", "Ananya", "Ishaan", "Kavya", "Reyansh", "Meera", "Arjun", "Saanvi", "Kabir", "Riya", "Vihaan", "Navya", "Aditya", "Pari", "Krish", "Tanvi", "Rohan", "Isha"];
const LAST = ["Shah", "Patel", "Mehta", "Desai", "Joshi", "Trivedi", "Pandya", "Raval", "Bhatt", "Vyas", "Parmar", "Chauhan", "Solanki", "Thakkar", "Dave"];

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

interface StudentRow { id: string; enrollment_no: string; name: string; department: string; semester: number; cgpa: number; attendance_pct: number; user_email: string | null }
interface FeeRow { id: string; enrollment_no: string; name: string; department: string; academic_year: string; amount_due: number; amount_paid: number; due_date: string; status: string; user_email: string | null }
interface EmployeeRow { id: string; employee_code: string; name: string; department: string; designation: string; email: string; salary: number; appraisal_rating: number; user_email: string | null }

const r = rng(42);
const STUDENTS: StudentRow[] = [];
const FEES: FeeRow[] = [];
for (const dept of DEPTS) {
  for (let i = 1; i <= 30; i++) {
    const enrollment = `AU23${dept}${String(i).padStart(3, "0")}`;
    const linked = dept === "CSE" && i === 1 ? PERSONAS[0] : dept === "MECH" && i === 1 ? PERSONAS[1] : null;
    const name = linked?.name ?? `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`;
    STUDENTS.push({
      id: enrollment, enrollment_no: enrollment, name, department: dept,
      semester: [1, 3, 5, 7][Math.floor(r() * 4)], cgpa: Math.round((5.5 + r() * 4.3) * 100) / 100,
      attendance_pct: Math.round((58 + r() * 40) * 10) / 10, user_email: linked?.email ?? null,
    });
    const roll = r();
    const status = linked === PERSONAS[0] ? "partial" : linked === PERSONAS[1] ? "paid" : roll < 0.6 ? "paid" : roll < 0.8 ? "partial" : roll < 0.92 ? "pending" : "overdue";
    const due = FEE[dept];
    const paid = status === "paid" ? due : status === "partial" ? Math.round((due * (0.4 + r() * 0.4)) / 1000) * 1000 : 0;
    FEES.push({
      id: `fee-${enrollment}`, enrollment_no: enrollment, name, department: dept, academic_year: "2026-27",
      amount_due: due, amount_paid: paid, due_date: status === "paid" || status === "overdue" ? "2026-08-31" : "2026-10-31",
      status, user_email: linked?.email ?? null,
    });
  }
}

const EMPLOYEES: EmployeeRow[] = [];
const persona = (key: string) => PERSONAS.find((p) => p.key === key)!;
for (const dept of DEPTS) {
  const hod = dept === "CSE" ? persona("hod_cse") : dept === "MECH" ? persona("hod_mech") : null;
  EMPLOYEES.push({
    id: `EMP${dept}H`, employee_code: `EMP${dept}H`, name: hod?.name ?? `Dr. ${FIRST[Math.floor(r() * 20)]} ${LAST[Math.floor(r() * 15)]}`,
    department: dept, designation: "Professor & Head", email: hod?.email ?? `emp${dept.toLowerCase()}h@atmiya.test`,
    salary: Math.round((2000000 + r() * 400000) / 1000) * 1000, appraisal_rating: 3 + Math.floor(r() * 3), user_email: hod?.email ?? null,
  });
  for (let i = 1; i <= 5; i++) {
    const linked = dept === "CSE" && i === 1 ? persona("faculty_cse") : null;
    const assoc = i <= 2;
    EMPLOYEES.push({
      id: `EMP${dept}${i}`, employee_code: `EMP${dept}${String(i).padStart(2, "0")}`,
      name: linked?.name ?? `Prof. ${FIRST[Math.floor(r() * 20)]} ${LAST[Math.floor(r() * 15)]}`,
      department: dept, designation: assoc ? "Associate Professor" : "Assistant Professor",
      email: linked?.email ?? `emp${dept.toLowerCase()}${i}@atmiya.test`,
      salary: linked ? 1640000 : Math.round(((assoc ? 1400000 : 800000) + r() * 400000) / 1000) * 1000,
      appraisal_rating: 1 + Math.floor(r() * 5), user_email: linked?.email ?? null,
    });
  }
}
for (const [key, dept, designation, salary] of [
  ["finance", "ACCOUNTS", "Accounts Officer", 1020000],
  ["hr", "HR", "HR Manager", 1180000],
  ["admin", "ADMIN", "IT Administrator", 1060000],
] as const) {
  const p = persona(key);
  EMPLOYEES.push({ id: `EMP-${key}`, employee_code: `EMP${dept.slice(0, 3)}01`, name: p.name, department: dept, designation, email: p.email, salary, appraisal_rating: 4, user_email: p.email });
}

const has = (u: User, ...roles: string[]) => roles.some((x) => u.roles.includes(x));
const inScope = (u: User, dept: string) => u.depts.includes("*") || u.depts.includes(dept);

export const TOTALS: Record<RecordKind, number> = { students: STUDENTS.length, fees: FEES.length, employees: EMPLOYEES.length };

export function mockRecords(kind: RecordKind, u: User): { count: number; rows: Row[] } {
  let rows: Row[];
  if (kind === "students") {
    rows = STUDENTS.filter(
      (s) => s.user_email === u.email || has(u, "admin", "finance", "hr") || (has(u, "faculty", "hod") && inScope(u, s.department)),
    ).map(({ user_email: _e, ...s }) => s);
  } else if (kind === "fees") {
    rows = FEES.filter((f) => has(u, "admin", "finance") || f.user_email === u.email).map(({ user_email: _e, ...f }) => f);
  } else {
    rows = EMPLOYEES.map(({ user_email, appraisal_rating, salary, ...e }) => {
      const self = user_email === u.email;
      return {
        ...e,
        salary: self || has(u, "hr", "finance", "admin") ? salary : null,
        appraisal_rating: self || has(u, "hr", "admin") ? appraisal_rating : null,
      };
    });
  }
  return { count: rows.length, rows };
}
