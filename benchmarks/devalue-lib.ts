import { parse, stringify } from 'devalue';

/**
 * devalue behind the SuperJSON call shape, so the harness can time it next to superjson.
 * devalue has no class, symbol or custom-type registry, so the harness skips fixture setup for it.
 */
export default class DevalueCodec {
  static readonly format = 'devalue';

  constructor(_options?: { dedupe?: boolean }) {}

  serialize(value: unknown) {
    return { json: stringify(value) };
  }

  deserialize(payload: { json: string }) {
    return parse(payload.json);
  }

  stringify(value: unknown) {
    return stringify(value);
  }

  parse(text: string) {
    return parse(text);
  }
}
