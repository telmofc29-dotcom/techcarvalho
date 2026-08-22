// High-intent PC troubleshooting cluster (August 2026 batch).
//
// Sourcing note: the procedural spine of each piece is taken from Microsoft's
// own documentation, and quoted rather than paraphrased where the exact wording
// carries a warning (e.g. "The initialization process erases all data on the
// disk."). Where a cause is engineering reasoning rather than a vendor claim,
// the body says so in the text — it is never dressed up as documented fact.

import type { ContentBatchImport } from "@/lib/content/import-types";

export const pcTroubleshooting2026: ContentBatchImport = {
  content: [
    {
      slug: "new-ssd-not-showing-up-in-windows",
      title: "Your New SSD Doesn't Show Up in Windows: Work Through It in This Order",
      type: "troubleshooting",
      status: "awaiting_media",
      categorySlug: "computing",
      searchIntent: "informational",
      primaryQuery: "new ssd not showing up windows",
      intentFingerprint: "new-ssd-not-showing-up-windows",
      tagSlugs: ["pc-hardware", "storage", "windows", "troubleshooting"],
      metaTitle: "New SSD Not Showing Up in Windows? Fix It in This Order",
      metaDescription:
        "A new drive missing from File Explorer is usually uninitialised, not broken. The safe order to check — with the exact step that erases data, flagged before you take it.",
      relatedContent: [
        { relatedSlug: "pc-building-basics-first-build-guide", type: "related_to" },
        { relatedSlug: "ps5-storage-expansion-compatible-ssd-guide", type: "related_to" },
        { relatedSlug: "powerful-pc-photo-video-editing-do-you-need-it", type: "related_to" },
      ],
      sources: [
        { url: "https://learn.microsoft.com/en-us/windows-server/storage/disk-management/initialize-new-disks", publisher: "Microsoft Learn", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://learn.microsoft.com/en-us/troubleshoot/windows-server/backup-and-storage/troubleshoot-disk-management", publisher: "Microsoft Learn", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://learn.microsoft.com/en-us/powershell/module/storage/initialize-disk", publisher: "Microsoft Learn", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
      ],
      body: `You installed a new SSD, Windows booted normally, and the drive is nowhere in File Explorer. This is one of those problems that feels like a dead drive and almost never is. In the overwhelming majority of cases the drive is present, healthy, and simply has not been through the one-time preparation Windows requires before it will show you a drive letter.

Microsoft states the situation plainly in its own documentation: "When you add a new disk to your computer, the disk isn't immediately available in Windows File Explorer. First, you need to initialize the disk so it's ready for use by Windows. You might also need to assign a drive letter to the disk."

So the first question is not "is my drive broken" — it is "does Windows see the disk at a lower level than File Explorer?"

## Read this before you touch anything

One step in this process destroys data, and it is the step everyone jumps to first.

Microsoft's warning on initialising a disk is explicit: "If you want to initialize a disk already in use, first save the existing files to a backup location. The initialization process erases all data on the disk."

That matters because Disk Management shows every disk in your machine in one list, identified only as Disk 0, Disk 1, Disk 2. If you initialise the wrong one, you have wiped a drive that was working. Before you click anything, match the disk you intend to touch by its capacity and its current contents — the disk you want is the one showing entirely unallocated space and the size of the drive you just fitted. If two disks in the list are the same size and you cannot tell them apart with certainty, stop and physically disconnect the other one first. That is a five-minute job; restoring a wiped drive is not.

The same warning applies doubly to diskpart. Its clean command is destructive and gives you no confirmation dialogue worth the name. There is no reason to reach for it on a brand-new drive.

## Step 1: does Disk Management see it?

Open Disk Management the way Microsoft documents it: from the Start menu, type Create and format hard disk partitions, then right-click that result and choose Run as administrator. (Microsoft notes the account needs to be in the Administrators or Backup Operators group.) If that route fails, open Computer Management as administrator instead and go to Storage → Disk Management.

Now look at the list of disks. There are three outcomes, and they send you down three different paths:

- The disk is listed, marked "Not Initialized". This is the common case. Go to Step 2.
- The disk is listed and initialised, but its space is "Unallocated", or it has a healthy partition with no drive letter. Skip to Step 3.
- The disk is not listed at all. Windows genuinely cannot see the hardware. Go to Step 4 — and do not initialise anything, because there is nothing there to initialise.

## Step 2: initialise, then create a volume

Having confirmed you have the right disk, Microsoft's documented sequence is:

- If the disk shows as Offline, right-click it and select Online.
- Right-click the disk and select Initialize Disk.
- In the dialog, confirm the correct disk is selected, check the partition style, and select OK. The default is GUID Partition Table (GPT).
- The status shows Initializing briefly, then Online.
- Right-click the Unallocated space, choose New Simple Volume, accept the default size (which uses the whole drive), assign a drive letter, choose NTFS, and finish.

On GPT versus MBR: take the default. Microsoft's guidance is that "most computers use the GPT disk type for hard drives and solid-state drives (SSDs)" because "GPT is more robust and allows for volumes larger than 2 terabytes," while MBR "is an older disk type" used by 32-bit and older computers and removable media. Microsoft's own summary is the useful one: "You don't usually have to worry about assigning the partition style."

If you prefer PowerShell, Microsoft documents the Initialize-Disk cmdlet as the equivalent. The GUI is safer here precisely because it makes you look at the disk you selected.

## Step 3: it's initialised but still invisible

Two sub-cases, both harmless:

- Healthy partition, no drive letter. Right-click the partition, choose Change Drive Letter and Paths, and add one. Nothing is erased by assigning a letter.
- Unallocated space on an initialised disk. Create a New Simple Volume as in Step 2. This formats that space, which on a new drive is empty anyway.

There is a third case worth naming: a drive that came from a Mac or a Linux machine and holds an APFS, HFS+ or ext4 filesystem. Windows will see the disk and the partition but not read it, so it never gets a drive letter. If the data on it matters, do not reformat — copy it off from a machine that can read it first. If it does not, deleting the partition and creating a new NTFS volume is the fix, and it erases that drive.

## Step 4: Disk Management can't see the disk at all

Now you are looking at a connection, configuration or hardware problem rather than a Windows formatting problem. Work down this list — it is ordered roughly by how often each one turns out to be the cause, and every step is reversible.

Check the BIOS/UEFI first. Reboot into your firmware setup and look at the storage or NVMe device list. If the firmware sees the drive but Windows does not, the problem is in Windows. If the firmware also cannot see it, Windows was never going to.

M.2 slot sharing. This is the single most common cause of a genuinely invisible NVMe drive, and it is a design decision rather than a fault: many motherboards share a limited pool of PCIe lanes between M.2 slots and certain SATA ports or a PCIe slot, so populating one disables another. Which slots conflict is specific to your board — the block diagram or the storage-configuration notes in your motherboard's own manual will state it, and there is no general rule that holds across boards. If the drive vanished and a SATA device also stopped appearing at the same time, this is almost certainly why. Moving the drive to a different M.2 slot is the test.

Physical seating. An M.2 drive sits at an angle until it is screwed down; it is easy to have it in the slot but not fully seated, and easy to lose the retention screw or standoff. Re-seat it, make sure it is pushed fully home before the screw goes in, and check the standoff is under the right mounting hole for the drive's length.

Cables, for SATA drives. Both the data cable and the power connector. Swap the SATA data cable for a known-good one and try a different port on the motherboard — a dead SATA port is uncommon but not rare.

A storage driver Windows setup doesn't have. If you are hitting this during a Windows installation rather than inside a running Windows, and the installer shows no drives at all, the usual cause is a storage controller mode — Intel's VMD/RST configuration in particular — where Windows setup needs the controller's driver loaded before it can see NVMe drives. The fix is either to load that driver at the "Load driver" prompt in setup, or to change the controller mode in firmware. Consult your motherboard vendor's page for your specific board before changing the mode, because changing it on a system that is already installed can stop it booting.

Test the drive elsewhere. A USB NVMe or SATA enclosure, or another machine, tells you in five minutes whether the drive itself is dead. If a second machine also sees nothing, you have a warranty claim rather than a configuration problem.

Microsoft also publishes a dedicated troubleshooting article for "Disks that are missing or not initialized," which is the right next stop if the disk appears and initialisation itself fails.

## When this does not matter to you

- You are looking at a drive that already has data on it and merely lost its letter. Assigning a letter is the whole fix — do not initialise, do not format, do not follow a guide that tells you to.
- The drive shows up fine but reports less capacity than the box claimed. That is a units question, not a fault: drive makers count a gigabyte as 1,000,000,000 bytes and Windows displays in binary units. A "1 TB" drive showing roughly 931 GB is behaving normally, and no amount of reinitialising changes it.
- You are on a Mac or Linux. None of the Windows-specific steps here apply; the underlying logic — the disk exists, it just has no usable filesystem or mount point yet — is the same, but the tools are Disk Utility or lsblk/gparted.

## If none of this worked

At this point you have established which of two very different problems you have. If Disk Management sees the disk but every attempt to initialise or format it fails with an I/O error, the drive is likely failing and the next step is the manufacturer's own diagnostic utility and a warranty claim — not more formatting attempts. If Disk Management and the firmware both see nothing, and the drive works in another machine, the problem is your slot, port or lane configuration, and your motherboard manual is now the most useful document you own.`,
    },

    {
      slug: "display-driver-stopped-responding-and-has-recovered",
      title: "\"Display Driver Stopped Responding and Has Recovered\": What It Means and How to Find the Cause",
      type: "troubleshooting",
      status: "awaiting_media",
      categorySlug: "computing",
      searchIntent: "informational",
      primaryQuery: "display driver stopped responding and has recovered",
      intentFingerprint: "display-driver-stopped-responding",
      tagSlugs: ["pc-hardware", "gpu", "drivers", "windows", "troubleshooting"],
      metaTitle: "Display Driver Stopped Responding and Has Recovered — Real Causes",
      metaDescription:
        "What Windows is actually telling you when the screen flickers and this message appears, what the message does not tell you, and how to narrow down the real cause.",
      relatedContent: [
        { relatedSlug: "psu-wattage-for-rtx-5090-build", type: "related_to" },
        { relatedSlug: "pc-building-basics-first-build-guide", type: "related_to" },
        { relatedSlug: "do-you-need-rtx-5090-for-1440p-gaming", type: "related_to" },
      ],
      sources: [
        { url: "https://learn.microsoft.com/en-us/windows-hardware/drivers/display/timeout-detection-and-recovery", publisher: "Microsoft Learn", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://learn.microsoft.com/en-us/windows-hardware/drivers/display/tdr-registry-keys", publisher: "Microsoft Learn", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
      ],
      body: `Your screen goes black for a second, comes back, and Windows tells you the display driver stopped responding and has recovered. Sometimes the game you were playing is still running. Sometimes it is a black window that has to be restarted. Sometimes it happens once a month and sometimes three times an hour.

Before you start changing things, it is worth understanding exactly what that message does and does not say — because almost every bad piece of advice about this error comes from misreading it.

## What Windows actually did

The mechanism is called Timeout Detection and Recovery, and Microsoft documents it precisely: "TDR is a feature in Windows that detects when the graphics card takes longer than expected to complete an operation. It then resets the graphics card to prevent the entire system from becoming unresponsive."

The specifics are worth having:

- The GPU scheduler inside Windows watches how long the graphics card takes on a task. "The default timeout period in Windows is two seconds." If the GPU cannot complete or be interrupted within that window, Windows declares it frozen.
- Recovery is a genuine reset. Microsoft describes the video memory manager purging "all allocations from video memory" and the driver resetting the GPU hardware state.
- "The only visible artifact from hang detection to recovery is a screen flicker" — that flicker is the whole event, from your side.
- Windows then "displays an informational message to the end user, saying 'Display driver stopped responding and has recovered'" and logs it in Event Viewer.
- Some applications survive this cleanly. Microsoft notes that "some legacy DirectX applications might just render black at the end of this recovery, which requires the end user to restart these applications."

And there is a threshold at which Windows stops being forgiving. By Microsoft's account, the OS "bug-checks the computer on the sixth (or more) GPU hang when it detects that five (5) or more GPU hangs (0x117) and subsequent recoveries occur within one (1) minute." In other words: if you are getting a blue screen rather than a recovery message, that is the same underlying event happening repeatedly, not a different problem.

Here is the part that matters most. The message tells you that the GPU did not respond within two seconds. It tells you nothing whatsoever about why. It is a symptom report, not a diagnosis — which is exactly why "reinstall your driver" is the internet's default answer and exactly why it so often fails to help.

## The one fix you should not start with

Microsoft documents a set of TDR registry keys for testing and debugging, including the timeout value itself. You will find a great many pages telling you to raise TdrDelay to make the error go away.

Be clear about what that does: it lengthens the window before Windows declares the GPU frozen. If your GPU is genuinely hanging because of an unstable overclock or failing hardware, raising the timeout does not stop it hanging — it stops Windows telling you, and converts a one-second flicker into a longer freeze. Microsoft's own framing of these keys is as a testing and debugging facility for driver developers, not as a consumer fix.

Editing the registry also carries real risk of breaking a working Windows install if you mistype a key. Treat this as a last resort, and only after you have ruled out the causes below — not as step one.

## Work through the real causes in this order

The ordering here is by how often each turns out to be the cause and how cheap it is to rule out, cheapest first. Each step is reversible.

### 1. A driver installation that went wrong

The most common genuinely-fixable cause, and the cheapest to test. Driver files can be left in a mixed state after an in-place upgrade, especially if you have changed graphics cards or gone back and forth between driver versions.

Both NVIDIA's and AMD's own installers include a clean-installation option that removes the previous driver's settings and files before installing. Use the vendor's own installer and tick that option — it is the vendor-supported path and should be tried before any third-party removal tool. Note that a clean install resets your driver control-panel settings, including any per-game profiles you had configured.

If the problem started immediately after a driver update, the other half of this test is to install the previous driver version instead. A regression in one specific driver release is a real and recurring phenomenon; if the older version is stable, you have your answer and the fix is to wait for the next release.

### 2. Anything you have overclocked or undervolted

This includes things you may not think of as overclocking:

- A GPU core or memory offset in an overclocking utility, including one that loads automatically at startup.
- An undervolt. Undervolting is not inherently safer than overclocking — an insufficient voltage is exactly as unstable as an excessive clock, and it typically shows up as a driver timeout under specific loads rather than as an obvious crash.
- A memory XMP or EXPO profile. This one surprises people, because it is system RAM rather than the graphics card, but an unstable memory profile produces corrupted data that the GPU is asked to work with, and a hang is a normal consequence.
- A factory-overclocked card that is marginal in your particular case temperature.

The test is decisive and free: set everything back to stock — GPU offsets to zero, memory to its default JEDEC speed rather than XMP/EXPO — and see whether the error stops. If it does, you have found the cause, and the fix is a less aggressive setting rather than a registry edit.

### 3. Heat and dust

A GPU that throttles is not the same as a GPU that hangs, but sustained thermal problems and hangs frequently travel together, and dust-clogged heatsinks and fans are a genuinely common cause of a machine that has been fine for two years and now is not.

Watch GPU temperature during the workload that triggers the error, using the vendor's own software. If the error correlates with the card reaching its highest temperatures rather than occurring at random, clean the heatsink and fans and confirm case airflow before doing anything else.

### 4. Power delivery

This one is reasoning rather than a documented vendor claim, so treat it as a hypothesis to test rather than an established cause: modern high-end graphics cards draw power in short spikes well above their nominal rating, and a power supply that is marginal, ageing, or shared awkwardly across daisy-chained cables can fail to deliver during those spikes. The failure mode is a GPU that stops responding under exactly the heaviest moments of a load.

Two things are worth checking regardless of whether this is your cause, because both are also safety matters:

- Use separate PCIe power cables to each connector on the card rather than daisy-chaining one cable into two connectors, if your PSU has enough cables to do so.
- Check the connector is fully seated. On 12VHPWR / 12V-2x6 connectors in particular, a partially inserted connector is a documented fire risk, not merely a stability one. It should click, and it should be straight and fully home with no visible gap. Re-seat it with the system powered off and unplugged.

If you are diagnosing a new build that is hitting this error under load, our PSU wattage guide covers sizing properly.

### 5. The cable and the display

Cheap to test and occasionally the entire answer. A marginal DisplayPort or HDMI cable, particularly at high refresh rates and high resolutions, produces link errors that can present as display driver problems. Swap the cable for a known-good one rated for the resolution and refresh rate you are actually running, and try a different port on the card.

If you are running multiple monitors at mixed refresh rates, test with a single monitor connected. That is not a permanent fix, but it is a fast way to isolate whether the multi-display configuration is involved.

### 6. Failing hardware

If stock clocks, a clean driver install, good temperatures, sound power delivery and a known-good cable still leave you with regular timeouts, the honest answer is that the card itself may be faulty. Test it in another machine, or test another card in yours. This is the point at which a warranty claim is the correct next step, and the point at which raising TdrDelay would be actively harmful, because it would hide the evidence.

## Reading the Event Viewer entry

Since Windows logs each occurrence, Event Viewer gives you something guesswork cannot: timestamps. Look under Windows Logs → System for the Display error events.

What you are looking for is a pattern. Do they cluster around a specific application? Around the moment a game loads a new area? Around startup, when an overclocking utility applies its profile? At random with the machine idle? A cause that only appears under load points at power, heat or clocks; one that appears at idle or on the desktop points much more strongly at the driver install or the display link.

## When this does not matter to you

- It happened once, months ago, and never again. A single recovery event is Windows doing its job — the mechanism exists precisely so that a one-off GPU hang costs you a flicker instead of a reboot. There is nothing to fix.
- You get it only in one specific old game. Microsoft explicitly notes that some legacy DirectX applications render black after a recovery. A single ill-behaved application on a system that is otherwise entirely stable is an application problem, and changing system-wide settings to accommodate it is the wrong trade.
- You are seeing blue screens with a completely different stop code. This article is about 0x117-class GPU hangs. A different bug check is a different investigation.

## The short version

The message means one thing: the GPU did not answer within two seconds and Windows reset it. Everything else is inference. Rule out the free, reversible causes in order — clean driver install, stock clocks including memory, temperatures, power connectors, cable — and only then consider that the hardware is at fault. Raising the timeout is not a fix; it is a way of not being told.`,
    },
  ],
};
