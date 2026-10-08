import type { Persona, User } from "./types";

// Test credentials for the seeded demo accounts (see backend/seed/dataset.py).
export const DEMO_PASSWORD = "Demo@123";

export const CLASSIFICATION = ["Public", "Internal", "Confidential", "Restricted"] as const;

export const PERSONAS: Persona[] = [
  {
    key: "student_cse", uid: "u-aarav", email: "aarav.student@atmiya.test", name: "Aarav Shah",
    roles: ["student"], depts: ["CSE"], clearance: 0, department: "CSE",
    title: "Student · CSE", blurb: "Sees public docs and only his own records.",
  },
  {
    key: "student_mech", uid: "u-diya", email: "diya.student@atmiya.test", name: "Diya Patel",
    roles: ["student"], depts: ["MECH"], clearance: 0, department: "MECH",
    title: "Student · MECH", blurb: "Different student, different private rows.",
  },
  {
    key: "faculty_cse", uid: "u-mehta", email: "prof.mehta@atmiya.test", name: "Prof. Kavita Mehta",
    roles: ["faculty"], depts: ["CSE"], clearance: 1, department: "CSE",
    title: "Faculty · CSE", blurb: "Internal policies, CSE students, her own pay.",
  },
  {
    key: "hod_cse", uid: "u-trivedi", email: "hod.cse@atmiya.test", name: "Dr. Rajesh Trivedi",
    roles: ["faculty", "hod"], depts: ["CSE"], clearance: 2, department: "CSE",
    title: "HOD · CSE", blurb: "Confidential CSE budget, no fees, no salaries.",
  },
  {
    key: "hod_mech", uid: "u-joshi", email: "hod.mech@atmiya.test", name: "Dr. Nisha Joshi",
    roles: ["faculty", "hod"], depts: ["MECH"], clearance: 2, department: "MECH",
    title: "HOD · MECH", blurb: "Same role as HOD CSE, other department.",
  },
  {
    key: "finance", uid: "u-desai", email: "finance@atmiya.test", name: "Hitesh Desai",
    roles: ["finance"], depts: ["*"], clearance: 2, department: "ACCOUNTS",
    title: "Finance Officer", blurb: "All budgets and fees, salaries but no appraisals.",
  },
  {
    key: "hr", uid: "u-rana", email: "hr@atmiya.test", name: "Pooja Rana",
    roles: ["hr"], depts: ["*"], clearance: 3, department: "HR",
    title: "HR Manager", blurb: "Restricted appraisals and compensation.",
  },
  {
    key: "admin", uid: "u-admin", email: "admin@atmiya.test", name: "System Admin",
    roles: ["admin"], depts: ["*"], clearance: 3, department: "ADMIN",
    title: "Administrator", blurb: "Everything in the tenant, plus the audit log.",
  },
];

export function personaFor(email: string): Persona | undefined {
  return PERSONAS.find((p) => p.email.toLowerCase() === email.toLowerCase());
}

export function toUser(p: Persona): User {
  const { key: _k, title: _t, blurb: _b, ...user } = p;
  return user;
}

export function initials(name: string): string {
  return name
    .replace(/^(Dr\.|Prof\.)\s*/, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}

export function roleLabel(user: User): string {
  return personaFor(user.email)?.title ?? user.roles.join(", ");
}
