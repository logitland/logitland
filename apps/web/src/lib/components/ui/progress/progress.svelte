<script lang="ts" module>
  import { type VariantProps, tv } from 'tailwind-variants';

  export const progressIndicatorVariants = tv({
    base: 'size-full flex-1 rounded-full transition-all',
    variants: {
      variant: {
        default: 'bg-primary',
        brand: 'bg-brand',
        warning: 'bg-warning',
        destructive: 'bg-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  });

  export type ProgressVariant = VariantProps<typeof progressIndicatorVariants>['variant'];
</script>

<script lang="ts">
  import { Progress as ProgressPrimitive } from 'bits-ui';
  import { cn, type WithoutChildrenOrChild } from '#lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    max = 100,
    value,
    variant = 'default',
    ...restProps
  }: WithoutChildrenOrChild<ProgressPrimitive.RootProps> & { variant?: ProgressVariant } = $props();
</script>

<ProgressPrimitive.Root
  bind:ref
  data-slot="progress"
  class={cn('bg-muted h-1.5 rounded-full relative flex w-full items-center overflow-x-hidden', className)}
  {value}
  {max}
  {...restProps}
>
  <div
    data-slot="progress-indicator"
    class={progressIndicatorVariants({ variant })}
    style="transform: translateX(-{100 - (100 * Math.min(value ?? 0, max ?? 1)) / (max ?? 1)}%)"
  ></div>
</ProgressPrimitive.Root>
