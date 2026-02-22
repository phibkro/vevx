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

// Not exported
function helper() {}
const INTERNAL = 42;
class InternalService {}
interface InternalConfig {}
type InternalId = string;
