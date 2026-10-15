import {
  isArray,
  isEmptyObject,
  isError,
  isMap,
  isPlainObject,
  isPrimitive,
  isSet,
} from './is.js';
import { escapeKey, stringifyPath } from './pathstringifier.js';
import {
  isInstanceOfRegisteredClass,
  transformValue,
  TypeAnnotation,
  untransformValue,
} from './transformer.js';
import { forEach } from './util.js';
import { parsePath } from './pathstringifier.js';
import { getDeep, setDeep } from './accessDeep.js';
import SuperJSON from './index.js';

type Tree<T> = InnerNode<T> | Leaf<T>;
type Leaf<T> = [T];
type InnerNode<T> = [T, Record<string, Tree<T>>];

export type MinimisedTree<T> = Tree<T> | Record<string, Tree<T>> | undefined;

const enableLegacyPaths = (version: number) => version < 1;

function traverse<T>(
  tree: MinimisedTree<T>,
  walker: (v: T, path: string[]) => void,
  version: number,
  origin: string[] = []
): void {
  if (!tree) {
    return;
  }

  const legacyPaths = enableLegacyPaths(version);
  if (!isArray(tree)) {
    forEach(tree, (subtree, key) =>
      traverse(subtree, walker, version, [
        ...origin,
        ...parsePath(key, legacyPaths),
      ])
    );
    return;
  }

  const [nodeValue, children] = tree;
  if (children) {
    forEach(children, (child, key) => {
      traverse(child, walker, version, [
        ...origin,
        ...parsePath(key, legacyPaths),
      ]);
    });
  }

  walker(nodeValue, origin);
}

export function applyValueAnnotations(
  plain: any,
  annotations: MinimisedTree<TypeAnnotation>,
  version: number,
  superJson: SuperJSON
) {
  traverse(
    annotations,
    (type, path) => {
      plain = setDeep(plain, path, v => untransformValue(v, type, superJson));
    },
    version
  );

  return plain;
}

export function applyReferentialEqualityAnnotations(
  plain: any,
  annotations: ReferentialEqualityAnnotations,
  version: number
) {
  const legacyPaths = enableLegacyPaths(version);
  function apply(identicalPaths: string[], path: string) {
    const object = getDeep(plain, parsePath(path, legacyPaths));

    identicalPaths
      .map(path => parsePath(path, legacyPaths))
      .forEach(identicalObjectPath => {
        plain = setDeep(plain, identicalObjectPath, () => object);
      });
  }

  if (isArray(annotations)) {
    const [root, other] = annotations;
    root.forEach(identicalPath => {
      plain = setDeep(
        plain,
        parsePath(identicalPath, legacyPaths),
        () => plain
      );
    });

    if (other) {
      forEach(other, apply);
    }
  } else {
    forEach(annotations, apply);
  }

  return plain;
}

const isDeep = (object: any, superJson: SuperJSON): boolean =>
  isPlainObject(object) ||
  isArray(object) ||
  isMap(object) ||
  isSet(object) ||
  isError(object) ||
  isInstanceOfRegisteredClass(object, superJson);

interface Result {
  transformedValue: any;
  annotations?: MinimisedTree<TypeAnnotation>;
}

export type ReferentialEqualityAnnotations =
  | Record<string, string[]>
  | [string[]]
  | [string[], Record<string, string[]>];

export function generateReferentialEqualityAnnotations(
  identitites: Map<any, any[][]>,
  dedupe: boolean
): ReferentialEqualityAnnotations | undefined {
  const result: Record<string, string[]> = {};
  let rootEqualityPaths: string[] | undefined = undefined;

  identitites.forEach(paths => {
    if (paths.length <= 1) {
      return;
    }

    // if we're not deduping, all of these objects continue existing.
    // putting the shortest path first makes it easier to parse for humans
    // if we're deduping though, only the first entry will still exist, so we can't do this optimisation.
    if (!dedupe) {
      paths = paths
        .map(path => path.map(String))
        .sort((a, b) => a.length - b.length);
    }

    const [representativePath, ...identicalPaths] = paths;

    if (representativePath.length === 0) {
      rootEqualityPaths = identicalPaths.map(stringifyPath);
    } else {
      result[stringifyPath(representativePath)] = identicalPaths.map(
        stringifyPath
      );
    }
  });

  if (rootEqualityPaths) {
    if (isEmptyObject(result)) {
      return [rootEqualityPaths];
    } else {
      return [rootEqualityPaths, result];
    }
  } else {
    return isEmptyObject(result) ? undefined : result;
  }
}

class PathNode {
  constructor(readonly parent: PathNode | null, readonly key: string) {}
}

const toPath = (node: PathNode | null): string[] => {
  const path: string[] = [];
  for (; node; node = node.parent) {
    path.push(node.key);
  }

  return path.reverse();
};

interface Seen {
  paths: (PathNode | null)[];
  result: Result | undefined;
}

interface WalkContext {
  superJson: SuperJSON;
  dedupe: boolean;
  /** Every non-primitive in visiting order. A missing `result` means the walk of it is still running. */
  seen: Map<unknown, Seen>;
  /** Annotations of the value the last `walk` call returned. */
  annotations: MinimisedTree<TypeAnnotation>;
}

function walk(
  object: any,
  ctx: WalkContext,
  parent: PathNode | null,
  key: string | null
): any {
  const primitive = isPrimitive(object);
  let seen: Seen | undefined;

  if (!primitive) {
    const node = key === null ? parent : new PathNode(parent, key);
    seen = ctx.seen.get(object);
    if (seen) {
      seen.paths.push(node);
      if (seen.result) {
        if (ctx.dedupe) {
          ctx.annotations = undefined;
          return null;
        }

        ctx.annotations = seen.result.annotations;
        return seen.result.transformedValue;
      }

      ctx.annotations = undefined;
      return isDeep(object, ctx.superJson)
        ? null
        : leaf(object, ctx, seen);
    }

    seen = { paths: [node], result: undefined };
    ctx.seen.set(object, seen);
    parent = node;
  }

  if (!isDeep(object, ctx.superJson)) {
    return leaf(object, ctx, seen);
  }

  if (primitive && key !== null) {
    parent = new PathNode(parent, key);
  }

  const transformationResult = transformValue(object, ctx.superJson);
  const transformed = transformationResult?.value ?? object;

  const transformedValue: any = isArray(transformed) ? [] : {};
  let innerAnnotations: Record<string, Tree<TypeAnnotation>> | undefined;

  const keys = Object.keys(transformed);
  for (let i = 0; i < keys.length; i++) {
    const index = keys[i];
    if (
      index === '__proto__' ||
      index === 'constructor' ||
      index === 'prototype'
    ) {
      throw new Error(
        `Detected property ${index}. This is a prototype pollution risk, please remove it from your object.`
      );
    }

    transformedValue[index] = walk(transformed[index], ctx, parent, index);

    const childAnnotations = ctx.annotations;
    if (isArray(childAnnotations)) {
      innerAnnotations ??= {};
      innerAnnotations[escapeKey(index)] = childAnnotations;
    } else if (isPlainObject(childAnnotations)) {
      innerAnnotations ??= {};
      const prefix = escapeKey(index) + '.';
      const childKeys = Object.keys(childAnnotations);
      for (let j = 0; j < childKeys.length; j++) {
        innerAnnotations[prefix + childKeys[j]] =
          childAnnotations[childKeys[j]];
      }
    }
  }

  const annotations: MinimisedTree<TypeAnnotation> = innerAnnotations
    ? transformationResult
      ? [transformationResult.type, innerAnnotations]
      : innerAnnotations
    : transformationResult
    ? [transformationResult.type]
    : undefined;

  if (seen) {
    seen.result = { transformedValue, annotations };
  }

  ctx.annotations = annotations;
  return transformedValue;
}

function leaf(object: any, ctx: WalkContext, seen: Seen | undefined) {
  const transformed = transformValue(object, ctx.superJson);
  const transformedValue = transformed ? transformed.value : object;
  const annotations: MinimisedTree<TypeAnnotation> = transformed
    ? [transformed.type]
    : undefined;

  if (seen) {
    seen.result = { transformedValue, annotations };
  }

  ctx.annotations = annotations;
  return transformedValue;
}

export function walkRoot(
  object: any,
  superJson: SuperJSON,
  dedupe: boolean
): Result & { identities: Map<any, any[][]> } {
  const ctx: WalkContext = {
    superJson,
    dedupe,
    seen: new Map(),
    annotations: undefined,
  };
  const transformedValue = walk(object, ctx, null, null);

  const identities = new Map<any, any[][]>();
  ctx.seen.forEach((seen, value) => {
    if (seen.paths.length > 1) {
      identities.set(value, seen.paths.map(toPath));
    }
  });

  return { transformedValue, annotations: ctx.annotations, identities };
}

export const walker = (
  object: any,
  identities: Map<any, any[][]>,
  superJson: SuperJSON,
  dedupe: boolean
): Result => {
  const result = walkRoot(object, superJson, dedupe);
  result.identities.forEach((paths, value) => identities.set(value, paths));

  return {
    transformedValue: result.transformedValue,
    annotations: result.annotations,
  };
};
