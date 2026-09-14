export type TimelineKind = "work" | "standby";

export type TimelineEntry = {
  id: string;
  time: string;
  endTime: string;
  text: string;
  /** First CXAlloy code — kept for older punches and imports. */
  cxalloy: string;
  /** Every CXAlloy code on this punch. */
  cxalloys: string[];
  workers: string[];
  kind: TimelineKind;
  standbyWhere: "" | "site" | "hotel";
  standbyReason: string;
  standbyNote: string;
  closed: boolean;
  /** Codes marked fixed on this punch. Empty means none, even if `closed` is true on old rows. */
  closedCodes: string[];
};

export type Person = {
  id: string;
  projectId: string;
  name: string;
  initials: string;
  active: boolean;
};

export type TechProfile = {
  fullName: string;
  initials: string;
  employeeNumber: string;
  phone: string;
  email: string;
  defaultTimeOn: string;
  defaultTimeOff: string;
};

export type RosterPerson = {
  id: string;
  name: string;
  initials: string;
  employeeNumber: string;
  active: boolean;
};

export function emptyProfile(): TechProfile {
  return {
    fullName: "",
    initials: "",
    employeeNumber: "",
    phone: "",
    email: "",
    defaultTimeOn: "0700",
    defaultTimeOff: "2000",
  };
}

export type IssueStatus = "open" | "in_progress" | "fixed";

/** Who owns the work, or why it is not a field fix. */
export type IssueDisposition =
  | "ours"
  | "reassigned"
  | "disputed"
  | "as_designed"
  | "needs_engineering";

export type Issue = {
  id: string;
  projectId: string;
  code: string;
  title: string;
  description: string;
  status: IssueStatus;
  priority: string;
  priorityLabel: string;
  assignedTo: string;
  asset: string;
  discipline: string;
  type: string;
  dueDate: string;
  createdBy: string;
  identifiedOn: string;
  closedBy: string;
  closedAtTime: string;
  minutesSpent: number;
  notes: string;
  lastImportAt: string | null;
  photoCount?: number;
  disposition: IssueDisposition;
  dispositionNote: string;
};


export type Project = {
  id: string;
  name: string;
  customer: string;
  wo: string;
  location: string;
  po: string;
  chargeCode: string;
  transportation: string;
  generatorSize: string;
  qty: string;
  operatingVoltage: string;
  dcVoltage: string;
  switchgearMfr: string;
  prints: string;
  jobTask: string;
  technician: string;
  initials: string;
  defaultTimeOn: string;
  defaultTimeOff: string;
  crew: string;
  createdAt: string;
  updatedAt: string;
  reportCount?: number;
  lastWorkDate?: string;
};

export type ReportSummary = {
  id: string;
  projectId: string;
  workDate: string;
  reportNo: string;
  entryCount: number;
  photoCount: number;
};

export type Report = {
  id: string;
  projectId: string;
  workDate: string;
  reportNo: string;
  timeOn: string;
  timeOff: string;
  mileage: string;
  estimatedCost: string;
  materialUsed: string;
  partsNeededText: string;
  jobComplete: boolean;
  partsNeeded: boolean;
  drawingsNeeded: boolean;
  returnCallNeeded: boolean;
  rentalNeeded: boolean;
  comments: string;
  customerSignName: string;
  entries: TimelineEntry[];
  crewToday: string[];
};

export type PhotoMeta = {
  id: string;
  caption: string;
  cxalloy: string;
  mime: string;
  sortOrder: number;
};

export type Photo = PhotoMeta & { dataB64: string };

export const QUICK_PUNCHES: { label: string; text: string; kind: TimelineKind }[] = [
  {
    label: "Arrive",
    kind: "work",
    text: "Arrived at the job site and gathered tools and supplies from the trucks.",
  },
  {
    label: "JSA",
    kind: "work",
    text: "Completed the toolbox talk and JSA for the day.",
  },
  {
    label: "Lunch",
    kind: "work",
    text: "Break for lunch.",
  },
  {
    label: "Cleanup",
    kind: "work",
    text: "Cleaned up the work area and staged materials.",
  },
  {
    label: "Depart",
    kind: "work",
    text: "Departed the job site.",
  },
  {
    label: "Hotel",
    kind: "work",
    text: "Arrived at the hotel and completed paperwork for the night.",
  },
];

export type CxalloyExportPhoto = {
  code: string;
  kind: "problem" | "evidence";
  mime: string;
  dataB64: string;
  caption: string;
  workDate: string;
};

export type CxalloyExportPunch = {
  code: string;
  workDate: string;
  text: string;
  closed: boolean;
  workers: string[];
};

export type IssuePhoto = {
  id: string;
  code: string;
  kind: "problem" | "evidence";
  mime: string;
  dataB64?: string;
  caption: string;
  workDate: string;
  fromReport?: boolean;
};

export function emptyProject(): Omit<Project, "id" | "createdAt" | "updatedAt"> {
  return {
    name: "",
    customer: "",
    wo: "",
    location: "",
    po: "",
    chargeCode: "",
    transportation: "Rental Car / Flight / Service Truck",
    generatorSize: "",
    qty: "",
    operatingVoltage: "",
    dcVoltage: "",
    switchgearMfr: "",
    prints: "",
    jobTask: "",
    technician: "",
    initials: "",
    defaultTimeOn: "0700",
    defaultTimeOff: "2000",
    crew: "",
  };
}
