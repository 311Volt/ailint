//AI_SPEC_BEGIN(def_operations): "implements all defined operations"

import { Operation } from "./operations";

function calculate(op: Operation, a: number, b: number): number {
  switch(op) {
    case Operation.add:
      return a + b;
    case Operation.subtract:
      return a - b;
    case Operation.multiply:
      return a * b;
    case Operation.divide:
      return b !== 0 ? a / b : NaN;
    default:
      throw new Error("Unknown operation");
  }
}

 
 //AI_SPEC_END(def_operations)
