export class SpecError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Spec invalid (${issues.length} issue${issues.length === 1 ? "" : "s"}):\n- ${issues.join("\n- ")}`);
    this.name = "SpecError";
    this.issues = issues;
  }
}

export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaError";
  }
}
