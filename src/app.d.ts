/// <reference path="../worker-configuration.d.ts" />

declare global {
  namespace App {
    interface Platform {
      env: Env;
      cf: unknown;
      ctx: ExecutionContext;
    }
  }
}

export {};
