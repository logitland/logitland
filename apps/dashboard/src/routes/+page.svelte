<script lang="ts">
  import BoldIcon from '@lucide/svelte/icons/bold';
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
  import FileIcon from '@lucide/svelte/icons/file';
  import InboxIcon from '@lucide/svelte/icons/inbox';
  import InfoIcon from '@lucide/svelte/icons/info';
  import ItalicIcon from '@lucide/svelte/icons/italic';
  import SearchIcon from '@lucide/svelte/icons/search';
  import UnderlineIcon from '@lucide/svelte/icons/underline';
  import { BarChart } from 'layerchart';
  import { toast } from 'svelte-sonner';
  import { superForm } from 'sveltekit-superforms';
  import * as Accordion from '#lib/components/ui/accordion/index.js';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
  import { AspectRatio } from '#lib/components/ui/aspect-ratio/index.js';
  import * as Attachment from '#lib/components/ui/attachment/index.js';
  import * as Avatar from '#lib/components/ui/avatar/index.js';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import * as Breadcrumb from '#lib/components/ui/breadcrumb/index.js';
  import * as Bubble from '#lib/components/ui/bubble/index.js';
  import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
  import * as ButtonGroup from '#lib/components/ui/button-group/index.js';
  import { Calendar } from '#lib/components/ui/calendar/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import * as Carousel from '#lib/components/ui/carousel/index.js';
  import * as Chart from '#lib/components/ui/chart/index.js';
  import { Checkbox } from '#lib/components/ui/checkbox/index.js';
  import * as CodeBlock from '#lib/components/ui/code-block/index.js';
  import * as Collapsible from '#lib/components/ui/collapsible/index.js';
  import * as Command from '#lib/components/ui/command/index.js';
  import * as ContextMenu from '#lib/components/ui/context-menu/index.js';
  import * as Dialog from '#lib/components/ui/dialog/index.js';
  import * as Drawer from '#lib/components/ui/drawer/index.js';
  import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import * as Form from '#lib/components/ui/form/index.js';
  import * as HoverCard from '#lib/components/ui/hover-card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import * as InputGroup from '#lib/components/ui/input-group/index.js';
  import * as InputOTP from '#lib/components/ui/input-otp/index.js';
  import * as Item from '#lib/components/ui/item/index.js';
  import * as Kbd from '#lib/components/ui/kbd/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import * as Marker from '#lib/components/ui/marker/index.js';
  import * as Menubar from '#lib/components/ui/menubar/index.js';
  import * as Message from '#lib/components/ui/message/index.js';
  import * as MessageScroller from '#lib/components/ui/message-scroller/index.js';
  import * as NativeSelect from '#lib/components/ui/native-select/index.js';
  import * as NavigationMenu from '#lib/components/ui/navigation-menu/index.js';
  import * as Pagination from '#lib/components/ui/pagination/index.js';
  import * as Popover from '#lib/components/ui/popover/index.js';
  import { Progress } from '#lib/components/ui/progress/index.js';
  import * as Questionnaire from '#lib/components/ui/questionnaire/index.js';
  import * as RadioGroup from '#lib/components/ui/radio-group/index.js';
  import { RangeCalendar } from '#lib/components/ui/range-calendar/index.js';
  import * as Resizable from '#lib/components/ui/resizable/index.js';
  import { ScrollArea } from '#lib/components/ui/scroll-area/index.js';
  import * as Select from '#lib/components/ui/select/index.js';
  import { Separator } from '#lib/components/ui/separator/index.js';
  import * as Sheet from '#lib/components/ui/sheet/index.js';
  import * as Sidebar from '#lib/components/ui/sidebar/index.js';
  import { Skeleton } from '#lib/components/ui/skeleton/index.js';
  import { Slider } from '#lib/components/ui/slider/index.js';
  import { Toaster } from '#lib/components/ui/sonner/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import { Switch } from '#lib/components/ui/switch/index.js';
  import * as Table from '#lib/components/ui/table/index.js';
  import * as Tabs from '#lib/components/ui/tabs/index.js';
  import { Textarea } from '#lib/components/ui/textarea/index.js';
  import { Toggle } from '#lib/components/ui/toggle/index.js';
  import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
  import * as Tooltip from '#lib/components/ui/tooltip/index.js';
  import * as Trace from '#lib/components/ui/trace/index.js';

  const form = superForm({ name: '' }, { SPA: true, validators: false });
  const { form: formData, enhance } = form;

  const chartData = [
    { month: 'Jan', value: 4 },
    { month: 'Feb', value: 7 },
    { month: 'Mar', value: 5 },
  ];
  const chartConfig = { value: { label: 'Value', color: 'var(--chart-2)' } } satisfies Chart.ChartConfig;

  let selectValue = $state('');
</script>

<Tooltip.Provider>
  <main
    class="grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-4 p-4 *:flex *:min-w-0 *:flex-col *:items-start *:gap-3 *:rounded-lg *:border *:p-4 [&_h2]:text-sm [&_h2]:font-medium [&_h2]:text-muted-foreground"
  >
    <section>
      <h2>Accordion</h2>
      <Accordion.Root type="single" class="w-full">
        <Accordion.Item value="one">
          <Accordion.Trigger>Item</Accordion.Trigger>
          <Accordion.Content>Content</Accordion.Content>
        </Accordion.Item>
      </Accordion.Root>
    </section>

    <section>
      <h2>Alert</h2>
      <Alert.Root>
        <CircleAlertIcon />
        <Alert.Title>Title</Alert.Title>
        <Alert.Description>Description</Alert.Description>
      </Alert.Root>
    </section>

    <section>
      <h2>Alert Dialog</h2>
      <AlertDialog.Root>
        <AlertDialog.Trigger class={buttonVariants({ variant: 'outline' })}>Open</AlertDialog.Trigger>
        <AlertDialog.Content>
          <AlertDialog.Header>
            <AlertDialog.Title>Title</AlertDialog.Title>
            <AlertDialog.Description>Description</AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action>Continue</AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </section>

    <section>
      <h2>Aspect Ratio</h2>
      <div class="w-full">
        <AspectRatio ratio={16 / 9} class="rounded-md bg-muted" />
      </div>
    </section>

    <section>
      <h2>Attachment</h2>
      <Attachment.Root>
        <Attachment.Media><FileIcon /></Attachment.Media>
        <Attachment.Content>
          <Attachment.Title>file.pdf</Attachment.Title>
          <Attachment.Description>2 MB</Attachment.Description>
        </Attachment.Content>
      </Attachment.Root>
    </section>

    <section>
      <h2>Avatar</h2>
      <Avatar.Root>
        <Avatar.Fallback>AB</Avatar.Fallback>
      </Avatar.Root>
    </section>

    <section>
      <h2>Badge</h2>
      <Badge>Badge</Badge>
    </section>

    <section>
      <h2>Breadcrumb</h2>
      <Breadcrumb.Root>
        <Breadcrumb.List>
          <Breadcrumb.Item><Breadcrumb.Link href="/">Home</Breadcrumb.Link></Breadcrumb.Item>
          <Breadcrumb.Separator />
          <Breadcrumb.Item><Breadcrumb.Page>Page</Breadcrumb.Page></Breadcrumb.Item>
        </Breadcrumb.List>
      </Breadcrumb.Root>
    </section>

    <section>
      <h2>Bubble</h2>
      <Bubble.Root>
        <Bubble.Content>Bubble</Bubble.Content>
      </Bubble.Root>
    </section>

    <section>
      <h2>Button</h2>
      <Button>Button</Button>
    </section>

    <section>
      <h2>Button Group</h2>
      <ButtonGroup.Root>
        <Button variant="outline">One</Button>
        <Button variant="outline">Two</Button>
      </ButtonGroup.Root>
    </section>

    <section>
      <h2>Calendar</h2>
      <Calendar type="single" class="rounded-md border" />
    </section>

    <section>
      <h2>Card</h2>
      <Card.Root class="w-full">
        <Card.Header>
          <Card.Title>Title</Card.Title>
          <Card.Description>Description</Card.Description>
        </Card.Header>
        <Card.Content>Content</Card.Content>
      </Card.Root>
    </section>

    <section>
      <h2>Carousel</h2>
      <Carousel.Root class="mx-12 w-[calc(100%-6rem)]">
        <Carousel.Content>
          {#each [1, 2, 3] as n (n)}
            <Carousel.Item>
              <div class="flex aspect-square items-center justify-center rounded-md border text-2xl font-semibold">{n}</div>
            </Carousel.Item>
          {/each}
        </Carousel.Content>
        <Carousel.Previous />
        <Carousel.Next />
      </Carousel.Root>
    </section>

    <section>
      <h2>Chart</h2>
      <Chart.Container config={chartConfig} class="h-40 w-full">
        <BarChart data={chartData} x="month" series={[{ key: 'value', label: chartConfig.value.label, color: chartConfig.value.color }]} axis="x">
          {#snippet tooltip()}
            <Chart.Tooltip />
          {/snippet}
        </BarChart>
      </Chart.Container>
    </section>

    <section>
      <h2>Checkbox</h2>
      <div class="flex items-center gap-2">
        <Checkbox id="checkbox" />
        <Label for="checkbox">Label</Label>
      </div>
    </section>

    <section>
      <h2>Code Block</h2>
      <CodeBlock.Root>
        <CodeBlock.Content code="pnpm dev" />
      </CodeBlock.Root>
    </section>

    <section>
      <h2>Collapsible</h2>
      <Collapsible.Root>
        <Collapsible.Trigger class={buttonVariants({ variant: 'outline' })}>Toggle</Collapsible.Trigger>
        <Collapsible.Content class="pt-2">Content</Collapsible.Content>
      </Collapsible.Root>
    </section>

    <section>
      <h2>Command</h2>
      <Command.Root class="rounded-lg border">
        <Command.Input placeholder="Search" />
        <Command.List>
          <Command.Empty>No results</Command.Empty>
          <Command.Group heading="Group">
            <Command.Item>One</Command.Item>
            <Command.Item>Two</Command.Item>
          </Command.Group>
        </Command.List>
      </Command.Root>
    </section>

    <section>
      <h2>Context Menu</h2>
      <ContextMenu.Root>
        <ContextMenu.Trigger class="flex h-20 w-full items-center justify-center rounded-md border border-dashed text-sm">Trigger</ContextMenu.Trigger>
        <ContextMenu.Content>
          <ContextMenu.Item>One</ContextMenu.Item>
          <ContextMenu.Item>Two</ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Root>
    </section>

    <section>
      <h2>Dialog</h2>
      <Dialog.Root>
        <Dialog.Trigger class={buttonVariants({ variant: 'outline' })}>Open</Dialog.Trigger>
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Title</Dialog.Title>
            <Dialog.Description>Description</Dialog.Description>
          </Dialog.Header>
        </Dialog.Content>
      </Dialog.Root>
    </section>

    <section>
      <h2>Drawer</h2>
      <Drawer.Root>
        <Drawer.Trigger class={buttonVariants({ variant: 'outline' })}>Open</Drawer.Trigger>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>Title</Drawer.Title>
            <Drawer.Description>Description</Drawer.Description>
          </Drawer.Header>
        </Drawer.Content>
      </Drawer.Root>
    </section>

    <section>
      <h2>Dropdown Menu</h2>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class={buttonVariants({ variant: 'outline' })}>Open</DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Item>One</DropdownMenu.Item>
          <DropdownMenu.Item>Two</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </section>

    <section>
      <h2>Empty</h2>
      <Empty.Root class="w-full border">
        <Empty.Header>
          <Empty.Media variant="icon"><InboxIcon /></Empty.Media>
          <Empty.Title>Title</Empty.Title>
          <Empty.Description>Description</Empty.Description>
        </Empty.Header>
      </Empty.Root>
    </section>

    <section>
      <h2>Field</h2>
      <Field.Field>
        <Field.Label for="field">Label</Field.Label>
        <Input id="field" />
        <Field.Description>Description</Field.Description>
      </Field.Field>
    </section>

    <section>
      <h2>Form</h2>
      <form method="POST" use:enhance class="flex w-full flex-col gap-3">
        <Form.Field {form} name="name">
          <Form.Control>
            {#snippet children({ props })}
              <Form.Label>Name</Form.Label>
              <Input {...props} bind:value={$formData.name} />
            {/snippet}
          </Form.Control>
          <Form.FieldErrors />
        </Form.Field>
        <Form.Button>Submit</Form.Button>
      </form>
    </section>

    <section>
      <h2>Hover Card</h2>
      <HoverCard.Root>
        <HoverCard.Trigger class={buttonVariants({ variant: 'link' })}>Hover</HoverCard.Trigger>
        <HoverCard.Content>Content</HoverCard.Content>
      </HoverCard.Root>
    </section>

    <section>
      <h2>Input</h2>
      <Input placeholder="Input" />
    </section>

    <section>
      <h2>Input Group</h2>
      <InputGroup.Root>
        <InputGroup.Input placeholder="Search" />
        <InputGroup.Addon><SearchIcon /></InputGroup.Addon>
      </InputGroup.Root>
    </section>

    <section>
      <h2>Input OTP</h2>
      <InputOTP.Root maxlength={6}>
        {#snippet children({ cells })}
          <InputOTP.Group>
            {#each cells as cell, i (i)}
              <InputOTP.Slot {cell} />
            {/each}
          </InputOTP.Group>
        {/snippet}
      </InputOTP.Root>
    </section>

    <section>
      <h2>Item</h2>
      <Item.Root variant="outline" class="w-full">
        <Item.Content>
          <Item.Title>Title</Item.Title>
          <Item.Description>Description</Item.Description>
        </Item.Content>
        <Item.Actions>
          <Button variant="outline" size="sm">Action</Button>
        </Item.Actions>
      </Item.Root>
    </section>

    <section>
      <h2>Kbd</h2>
      <Kbd.Group>
        <Kbd.Root>⌘</Kbd.Root>
        <Kbd.Root>K</Kbd.Root>
      </Kbd.Group>
    </section>

    <section>
      <h2>Label</h2>
      <Label>Label</Label>
    </section>

    <section>
      <h2>Marker</h2>
      <Marker.Root>
        <Marker.Icon><InfoIcon /></Marker.Icon>
        <Marker.Content>Marker</Marker.Content>
      </Marker.Root>
    </section>

    <section>
      <h2>Menubar</h2>
      <Menubar.Root>
        <Menubar.Menu>
          <Menubar.Trigger>File</Menubar.Trigger>
          <Menubar.Content>
            <Menubar.Item>One</Menubar.Item>
            <Menubar.Item>Two</Menubar.Item>
          </Menubar.Content>
        </Menubar.Menu>
        <Menubar.Menu>
          <Menubar.Trigger>Edit</Menubar.Trigger>
          <Menubar.Content>
            <Menubar.Item>One</Menubar.Item>
          </Menubar.Content>
        </Menubar.Menu>
      </Menubar.Root>
    </section>

    <section>
      <h2>Message</h2>
      <Message.Root>
        <Message.Avatar>
          <Avatar.Root><Avatar.Fallback>AB</Avatar.Fallback></Avatar.Root>
        </Message.Avatar>
        <Message.Content>
          <Bubble.Root variant="muted">
            <Bubble.Content>Message</Bubble.Content>
          </Bubble.Root>
        </Message.Content>
      </Message.Root>
    </section>

    <section>
      <h2>Message Scroller</h2>
      <MessageScroller.Provider>
        <MessageScroller.Root class="h-32 w-full rounded-md border">
          <MessageScroller.Viewport>
            <MessageScroller.Content class="p-3">
              {#each [1, 2, 3, 4, 5] as n (n)}
                <MessageScroller.Item messageId={`message-${n}`}>
                  <Bubble.Root variant="muted"><Bubble.Content>Message {n}</Bubble.Content></Bubble.Root>
                </MessageScroller.Item>
              {/each}
            </MessageScroller.Content>
          </MessageScroller.Viewport>
        </MessageScroller.Root>
      </MessageScroller.Provider>
    </section>

    <section>
      <h2>Native Select</h2>
      <NativeSelect.Root>
        <NativeSelect.Option value="one">One</NativeSelect.Option>
        <NativeSelect.Option value="two">Two</NativeSelect.Option>
      </NativeSelect.Root>
    </section>

    <section>
      <h2>Navigation Menu</h2>
      <NavigationMenu.Root>
        <NavigationMenu.List>
          <NavigationMenu.Item>
            <NavigationMenu.Trigger>Menu</NavigationMenu.Trigger>
            <NavigationMenu.Content class="p-2">
              <NavigationMenu.Link href="/">Link</NavigationMenu.Link>
            </NavigationMenu.Content>
          </NavigationMenu.Item>
        </NavigationMenu.List>
      </NavigationMenu.Root>
    </section>

    <section>
      <h2>Pagination</h2>
      <Pagination.Root count={30} perPage={10}>
        {#snippet children({ pages, currentPage })}
          <Pagination.Content>
            <Pagination.Item><Pagination.Previous /></Pagination.Item>
            {#each pages as page (page.key)}
              {#if page.type === 'ellipsis'}
                <Pagination.Item><Pagination.Ellipsis /></Pagination.Item>
              {:else}
                <Pagination.Item>
                  <Pagination.Link {page} isActive={currentPage === page.value}>{page.value}</Pagination.Link>
                </Pagination.Item>
              {/if}
            {/each}
            <Pagination.Item><Pagination.Next /></Pagination.Item>
          </Pagination.Content>
        {/snippet}
      </Pagination.Root>
    </section>

    <section>
      <h2>Popover</h2>
      <Popover.Root>
        <Popover.Trigger class={buttonVariants({ variant: 'outline' })}>Open</Popover.Trigger>
        <Popover.Content>Content</Popover.Content>
      </Popover.Root>
    </section>

    <section>
      <h2>Progress</h2>
      <Progress value={60} />
    </section>

    <section>
      <h2>Questionnaire</h2>
      <Questionnaire.Root class="w-full" items={[{ name: 'answer', choices: [{ value: 'one' }, { value: 'two' }] }]}>
        <Questionnaire.Item name="answer">
          <Questionnaire.Title>Title</Questionnaire.Title>
          <Questionnaire.Choices>
            <Questionnaire.Choice value="one">One</Questionnaire.Choice>
            <Questionnaire.Choice value="two">Two</Questionnaire.Choice>
          </Questionnaire.Choices>
        </Questionnaire.Item>
        <Questionnaire.Actions>
          <Questionnaire.Submit>Submit</Questionnaire.Submit>
        </Questionnaire.Actions>
      </Questionnaire.Root>
    </section>

    <section>
      <h2>Radio Group</h2>
      <RadioGroup.Root value="one">
        <div class="flex items-center gap-2">
          <RadioGroup.Item value="one" id="radio-one" />
          <Label for="radio-one">One</Label>
        </div>
        <div class="flex items-center gap-2">
          <RadioGroup.Item value="two" id="radio-two" />
          <Label for="radio-two">Two</Label>
        </div>
      </RadioGroup.Root>
    </section>

    <section>
      <h2>Range Calendar</h2>
      <RangeCalendar class="rounded-md border" />
    </section>

    <section>
      <h2>Resizable</h2>
      <Resizable.PaneGroup direction="horizontal" class="min-h-24 rounded-md border">
        <Resizable.Pane defaultSize={50} class="flex items-center justify-center text-sm">One</Resizable.Pane>
        <Resizable.Handle withHandle />
        <Resizable.Pane defaultSize={50} class="flex items-center justify-center text-sm">Two</Resizable.Pane>
      </Resizable.PaneGroup>
    </section>

    <section>
      <h2>Scroll Area</h2>
      <ScrollArea class="h-24 w-full rounded-md border">
        <div class="p-3 text-sm">
          {#each Array.from({ length: 12 }, (_, i) => i + 1) as n (n)}
            <div>Row {n}</div>
          {/each}
        </div>
      </ScrollArea>
    </section>

    <section>
      <h2>Select</h2>
      <Select.Root type="single" bind:value={selectValue}>
        <Select.Trigger class="w-40">{selectValue || 'Select'}</Select.Trigger>
        <Select.Content>
          <Select.Item value="One" label="One" />
          <Select.Item value="Two" label="Two" />
        </Select.Content>
      </Select.Root>
    </section>

    <section>
      <h2>Separator</h2>
      <Separator />
    </section>

    <section>
      <h2>Sheet</h2>
      <Sheet.Root>
        <Sheet.Trigger class={buttonVariants({ variant: 'outline' })}>Open</Sheet.Trigger>
        <Sheet.Content>
          <Sheet.Header>
            <Sheet.Title>Title</Sheet.Title>
            <Sheet.Description>Description</Sheet.Description>
          </Sheet.Header>
        </Sheet.Content>
      </Sheet.Root>
    </section>

    <section>
      <h2>Sidebar</h2>
      <Sidebar.Provider class="min-h-0 overflow-hidden rounded-md border">
        <Sidebar.Root collapsible="none">
          <Sidebar.Content>
            <Sidebar.Group>
              <Sidebar.GroupLabel>Group</Sidebar.GroupLabel>
              <Sidebar.Menu>
                <Sidebar.MenuItem><Sidebar.MenuButton isActive>One</Sidebar.MenuButton></Sidebar.MenuItem>
                <Sidebar.MenuItem><Sidebar.MenuButton>Two</Sidebar.MenuButton></Sidebar.MenuItem>
              </Sidebar.Menu>
            </Sidebar.Group>
          </Sidebar.Content>
        </Sidebar.Root>
      </Sidebar.Provider>
    </section>

    <section>
      <h2>Skeleton</h2>
      <Skeleton class="h-4 w-full" />
      <Skeleton class="h-4 w-2/3" />
    </section>

    <section>
      <h2>Slider</h2>
      <Slider type="single" value={50} />
    </section>

    <section>
      <h2>Sonner</h2>
      <Button variant="outline" onclick={() => toast('Toast')}>Show</Button>
      <Toaster />
    </section>

    <section>
      <h2>Spinner</h2>
      <Spinner />
    </section>

    <section>
      <h2>Switch</h2>
      <div class="flex items-center gap-2">
        <Switch id="switch" />
        <Label for="switch">Label</Label>
      </div>
    </section>

    <section>
      <h2>Table</h2>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Name</Table.Head>
            <Table.Head>Value</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          <Table.Row>
            <Table.Cell>One</Table.Cell>
            <Table.Cell>1</Table.Cell>
          </Table.Row>
          <Table.Row>
            <Table.Cell>Two</Table.Cell>
            <Table.Cell>2</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table.Root>
    </section>

    <section>
      <h2>Tabs</h2>
      <Tabs.Root value="one">
        <Tabs.List>
          <Tabs.Trigger value="one">One</Tabs.Trigger>
          <Tabs.Trigger value="two">Two</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="one">One</Tabs.Content>
        <Tabs.Content value="two">Two</Tabs.Content>
      </Tabs.Root>
    </section>

    <section>
      <h2>Textarea</h2>
      <Textarea placeholder="Textarea" />
    </section>

    <section>
      <h2>Toggle</h2>
      <Toggle aria-label="Bold"><BoldIcon /></Toggle>
    </section>

    <section>
      <h2>Toggle Group</h2>
      <ToggleGroup.Root type="multiple" variant="outline">
        <ToggleGroup.Item value="bold" aria-label="Bold"><BoldIcon /></ToggleGroup.Item>
        <ToggleGroup.Item value="italic" aria-label="Italic"><ItalicIcon /></ToggleGroup.Item>
        <ToggleGroup.Item value="underline" aria-label="Underline"><UnderlineIcon /></ToggleGroup.Item>
      </ToggleGroup.Root>
    </section>

    <section>
      <h2>Tooltip</h2>
      <Tooltip.Root>
        <Tooltip.Trigger class={buttonVariants({ variant: 'outline' })}>Hover</Tooltip.Trigger>
        <Tooltip.Content>Tooltip</Tooltip.Content>
      </Tooltip.Root>
    </section>

    <section>
      <h2>Trace</h2>
      <Trace.Root>
        <Trace.Line>
          <Trace.Icon><SearchIcon /></Trace.Icon>
          <Trace.Title>Title</Trace.Title>
          <Trace.Description>Description</Trace.Description>
        </Trace.Line>
        <Trace.Line status="running">
          <Trace.Title>Running</Trace.Title>
        </Trace.Line>
      </Trace.Root>
    </section>
  </main>
</Tooltip.Provider>
