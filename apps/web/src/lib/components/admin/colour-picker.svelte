<script lang="ts">
  import { mode } from 'mode-watcher';
  import { buttonVariants } from '#lib/components/ui/button/index.js';
  import * as Popover from '#lib/components/ui/popover/index.js';
  import { Slider } from '#lib/components/ui/slider/index.js';
  import { COLOUR_PRESETS, colourName, type LevelColour } from '#lib/levels.js';
  import { BAR_LIGHTNESS, linearRgb, maxChroma, srgb } from '#lib/oklch.js';
  import { cn } from '#lib/utils.js';

  /**
   * Picks any colour for a level, or none (`undefined`, so the level tweens). A colour is hue and chroma only; the
   * theme supplies lightness, so the plane is drawn at the bar's own lightness and shows the bar as it will look.
   */
  let { value = $bindable(), label }: { value: LevelColour | undefined; label: string } = $props();

  const MAX_CHROMA = 0.25;
  const [WIDTH, HEIGHT] = [360, 120];

  let canvas = $state<HTMLCanvasElement>();
  const round = (n: number, digits: number) => Number(n.toFixed(digits));

  $effect(() => {
    const context = canvas?.getContext('2d');
    if (!context) return;
    const { lightness, chroma: scale } = BAR_LIGHTNESS[mode.current === 'dark' ? 'dark' : 'light'];
    const image = context.createImageData(WIDTH, HEIGHT);
    for (let x = 0; x < WIDTH; x++) {
      const hue = (x * 360) / WIDTH;
      // Above what sRGB can show, draw the strongest showable colour of this hue: smooth, with no hue shift.
      const ceiling = maxChroma(lightness, hue, MAX_CHROMA * scale);
      for (let y = 0; y < HEIGHT; y++) {
        const chroma = Math.min((1 - y / (HEIGHT - 1)) * MAX_CHROMA * scale, ceiling);
        const [r, g, b] = srgb(linearRgb(lightness, chroma, hue));
        image.data.set([r, g, b, 255], (y * WIDTH + x) * 4);
      }
    }
    context.putImageData(image, 0, 0);
  });

  function pick(event: PointerEvent) {
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    value = { hue: Math.round(x * 359), chroma: round((1 - y) * MAX_CHROMA, 3) };
  }

  function drag(event: PointerEvent) {
    canvas?.setPointerCapture(event.pointerId);
    pick(event);
  }

  const name = $derived(value ? (colourName(value) ?? 'Custom') : 'Tween');
</script>

{#snippet swatch(colour: LevelColour, className: string)}
  <span class={cn('level-accent shrink-0 rounded-full bg-brand', className)} style:--level-hue={colour.hue} style:--level-chroma={colour.chroma} aria-hidden="true"></span>
{/snippet}

<Popover.Root>
  <Popover.Trigger class={buttonVariants({ variant: 'outline', size: 'sm', class: 'w-32 justify-start gap-2' })} aria-label="{label} colour: {name}">
    {#if value}
      {@render swatch(value, 'size-3')}{name}
    {:else}
      <span class="text-muted-foreground">Tween</span>
    {/if}
  </Popover.Trigger>
  <Popover.Content align="end" class="w-72 gap-3">
    <div class="relative">
      <canvas
        bind:this={canvas}
        width={WIDTH}
        height={HEIGHT}
        class="block h-32 w-full cursor-crosshair touch-none rounded-md bg-muted"
        onpointerdown={drag}
        onpointermove={(event) => event.buttons === 1 && pick(event)}
        aria-hidden="true"
      ></canvas>
      {#if value}
        <span
          class="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background shadow-sm ring-1 ring-foreground/40"
          style:left="{(value.hue / 359) * 100}%"
          style:top="{(1 - value.chroma / MAX_CHROMA) * 100}%"
        ></span>
      {/if}
    </div>

    <div class="grid grid-cols-[3.5rem_minmax(0,1fr)_2.75rem] items-center gap-x-3 gap-y-3 text-xs">
      <span class="text-muted-foreground">Hue</span>
      <Slider
        type="single"
        min={0}
        max={359}
        step={1}
        aria-label="{label} hue"
        bind:value={() => value?.hue ?? 0, (hue) => (value = { hue, chroma: value?.chroma ?? 0.12 })}
      />
      <span class="text-right tabular-nums">{value ? `${value.hue}°` : '—'}</span>
      <span class="text-muted-foreground">Intensity</span>
      <Slider
        type="single"
        min={0}
        max={MAX_CHROMA}
        step={0.005}
        aria-label="{label} intensity"
        bind:value={() => value?.chroma ?? 0, (chroma) => (value = { hue: value?.hue ?? 0, chroma: round(chroma, 3) })}
      />
      <span class="text-right tabular-nums">{value ? `${Math.round((value.chroma / MAX_CHROMA) * 100)}%` : '—'}</span>
    </div>

    <div class="flex items-center gap-1">
      {#each COLOUR_PRESETS as preset (preset.name)}
        {@const current = value !== undefined && colourName(value) === preset.name}
        <button
          type="button"
          class={cn(
            'grid size-6 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            current && 'ring-2 ring-foreground/60',
          )}
          aria-label={preset.name}
          aria-pressed={current}
          onclick={() => (value = { hue: preset.hue, chroma: preset.chroma })}
        >
          {@render swatch(preset, 'size-4')}
        </button>
      {/each}
    </div>
    <button
      type="button"
      class={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-full')}
      aria-pressed={value === undefined}
      onclick={() => (value = undefined)}
    >
      Tween instead
    </button>
  </Popover.Content>
</Popover.Root>
