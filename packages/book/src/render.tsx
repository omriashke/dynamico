import type { CSSProperties } from 'react';
import type { DynamicError } from '@omriashke/dynamico-web';
import { DynamicComponent } from '@omriashke/dynamico-web';
import { resolveBookFixtures } from './fixtures.js';
import type { BookBlock, BookBlockItem, BookEntry, JsonObject, JsonValue } from './types.js';

export function resolveFixtures(
  props: JsonObject | undefined,
  fixtures: Record<string, JsonObject>,
): JsonObject {
  return resolveBookFixtures(props, fixtures) as JsonObject;
}

function resolvePropValue(value: JsonValue, fixtures: Record<string, JsonObject>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => resolvePropValue(item, fixtures));
  }
  if ('$fn' in value && value.$fn === 'noop') {
    return () => undefined;
  }
  if ('$component' in value && typeof value.$component === 'string') {
    const nestedProps = resolveFixtures((value.props as JsonObject | undefined) ?? {}, fixtures);
    return (
      <LiveComponent
        name={value.$component}
        props={resolvePropsForLiveComponent(nestedProps, fixtures)}
      />
    );
  }
  return resolvePropsForLiveComponent(value as JsonObject, fixtures);
}

export function resolvePropsForLiveComponent(
  props: JsonObject,
  fixtures: Record<string, JsonObject>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    out[key] = resolvePropValue(value, fixtures);
  }
  return out;
}

function LiveComponent({
  name,
  props,
}: {
  name: string;
  props?: Record<string, unknown>;
}) {
  return (
    <DynamicComponent
      name={name}
      props={props}
      fallback={<div className="db-loading">Loading {name}…</div>}
      errorFallback={LiveError}
    />
  );
}

function LiveError({ error }: { error: DynamicError }) {
  return (
    <div className="db-error">
      <strong>
        [{error.kind}] {error.name}
      </strong>
      <p>{error.message}</p>
    </div>
  );
}

function ComponentItem({
  item,
  fixtures,
}: {
  item: BookBlockItem;
  fixtures: Record<string, JsonObject>;
}) {
  const props = resolveFixtures(item.props, fixtures);
  return (
    <LiveComponent name={item.component} props={resolvePropsForLiveComponent(props, fixtures)} />
  );
}

function BlockView({
  block,
  fixtures,
}: {
  block: BookBlock;
  fixtures: Record<string, JsonObject>;
}) {
  switch (block.type) {
    case 'component':
      return (
        <ComponentItem item={{ component: block.component, props: block.props }} fixtures={fixtures} />
      );
    case 'stack': {
      const style: CSSProperties = {
        display: 'flex',
        flexDirection: 'column',
        gap: block.gap ?? (block.items.length > 1 ? 16 : undefined),
        width: block.width,
      };
      return (
        <div style={style}>
          {block.items.map((item, index) => (
            <ComponentItem key={`${item.component}-${index}`} item={item} fixtures={fixtures} />
          ))}
        </div>
      );
    }
    case 'row': {
      const style: CSSProperties = {
        display: 'flex',
        gap: block.gap ?? 20,
        alignItems: (block.align as CSSProperties['alignItems']) ?? 'center',
      };
      return (
        <div style={style}>
          {block.items.map((item, index) => (
            <ComponentItem key={`${item.component}-${index}`} item={item} fixtures={fixtures} />
          ))}
        </div>
      );
    }
    case 'variantGrid':
      return (
        <div className="db-variant-grid">
          {block.variants.map((variant) => {
            const props = resolveFixtures(variant.props, fixtures);
            return (
              <div key={variant.id} className="db-variant-row">
                <span className="db-variant-label">{variant.id}</span>
                <LiveComponent
                  name={block.component}
                  props={resolvePropsForLiveComponent(props, fixtures)}
                />
              </div>
            );
          })}
        </div>
      );
    default:
      return null;
  }
}

function InfoPanel({ registryUrl }: { registryUrl: string }) {
  return (
    <div className="db-info">
      <p>
        Components load live from <code>{registryUrl}</code>.
      </p>
      <p>
        Edit <code>book.config.json</code> in your Dynamico source folder — sidebar and previews
        update automatically.
      </p>
    </div>
  );
}

export function entryCanvasStyle(entry: BookEntry | undefined): CSSProperties {
  if (entry?.layout === 'fullscreen') return { padding: 0 };
  if (entry?.layout === 'padded') return { padding: 24 };
  return {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    padding: 24,
  };
}

export function BookEntryCanvas({
  entry,
  fixtures,
  registryUrl,
}: {
  entry: BookEntry;
  fixtures: Record<string, JsonObject>;
  registryUrl: string;
}) {
  if (entry.kind === 'info') {
    return <InfoPanel registryUrl={registryUrl} />;
  }
  const blocks = entry.blocks ?? [];
  return (
    <>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} fixtures={fixtures} />
      ))}
    </>
  );
}
