// Exported declarations
/** Greet a user by name. */
export function greet(name: string): string {
  return `Hello ${name}`;
}
export const MAX_COUNT = 100;
export class UserService {
  constructor(public name: string) {}
}
export interface Config {
  debug: boolean;
}
export type ID = string | number;
export default function defaultFn() {}
export { something } from "./other.js";
export type { SomeType } from "./other.js";

// Not exported — intentionally unused, used by ExportDetection tests
// eslint-disable-next-line no-unused-vars
function helper() {}
// eslint-disable-next-line no-unused-vars
const INTERNAL = 42;
// eslint-disable-next-line no-unused-vars
class InternalService {}
// eslint-disable-next-line no-unused-vars
interface InternalConfig {}
// eslint-disable-next-line no-unused-vars
type InternalId = string;
