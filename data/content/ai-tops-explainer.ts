// Evergreen explainer: what an "AI TOPS" figure actually measures.
//
// SOURCING NOTE: every figure in this article was taken from a vendor's own
// published specification or newsroom page (see `sources`), and each one is
// quoted with the precision the vendor actually stated — or explicitly marked
// as "precision not published" where they did not. Nothing here is a
// measurement by Tech Carvalho, and no benchmark number is quoted at all.
// Where a vendor declines to publish a detail (Apple's M5 TOPS figure,
// Microsoft's precision for the 40 TOPS bar), the absence is reported as the
// fact it is rather than filled in from secondary reporting.

import type { ContentBatchImport } from "@/lib/content/import-types";

export const aiTopsExplainer: ContentBatchImport = {
  content: [
    {
      slug: "ai-tops-explained-what-it-does-and-doesnt-tell-you",
      title: "AI TOPS Explained: What the Number Does and Doesn't Tell You",
      type: "guide",
      status: "awaiting_media",
      categorySlug: "ai-hardware",
      searchIntent: "informational",
      primaryQuery: "what is ai tops",
      intentFingerprint: "ai-tops-explained",
      tagSlugs: ["ai", "npu", "pc-hardware", "consumer-hardware", "intel", "amd", "apple"],
      metaTitle: "AI TOPS Explained: What the Number Really Tells You",
      metaDescription:
        "TOPS is on every AI PC spec sheet, but it changes with precision, sparsity and which chip you count. What the number means, and why it barely predicts local LLM speed.",
      relatedContent: [
        { relatedSlug: "what-ai-pc-actually-means", type: "supporting_of" },
        { relatedSlug: "local-llm-hardware-requirements", type: "related_to" },
        { relatedSlug: "ai-phone-camera-real-vs-marketing", type: "related_to" },
      ],
      sources: [
        { url: "https://learn.microsoft.com/en-us/windows/ai/npu-devices/", publisher: "Microsoft", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.nvidia.com/en-us/data-center/tesla-t4/", publisher: "NVIDIA", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.nvidia.com/en-us/data-center/a100/", publisher: "NVIDIA", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.nvidia.com/en-us/autonomous-machines/embedded-systems/jetson-orin/", publisher: "NVIDIA", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://developer.nvidia.com/blog/accelerating-inference-with-sparsity-using-ampere-and-tensorrt/", publisher: "NVIDIA", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.intel.com/content/www/us/en/products/sku/240956/intel-core-ultra-7-processor-266v-12m-cache-up-to-5-00-ghz/specifications.html", publisher: "Intel", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.intel.com/content/www/us/en/products/sku/241067/intel-core-ultra-5-processor-245k-24m-cache-up-to-5-20-ghz/specifications.html", publisher: "Intel", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.intel.com/content/www/us/en/newsroom/news/core-ultra-200v-series-mobile.html", publisher: "Intel", reliabilityTier: "primary", claimStatus: "official_announcement" },
        { url: "https://www.qualcomm.com/products/mobile/snapdragon/pcs-and-tablets/snapdragon-x-elite", publisher: "Qualcomm", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.amd.com/en/products/processors/laptop/ryzen/ai-300-series/amd-ryzen-ai-9-hx-370.html", publisher: "AMD", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://www.apple.com/newsroom/2024/05/apple-introduces-m4-chip/", publisher: "Apple", reliabilityTier: "primary", claimStatus: "official_announcement" },
        { url: "https://www.apple.com/newsroom/2025/10/apple-unleashes-m5-the-next-big-leap-in-ai-performance-for-apple-silicon/", publisher: "Apple", reliabilityTier: "primary", claimStatus: "official_announcement" },
        { url: "https://developer.nvidia.com/blog/mastering-llm-techniques-inference-optimization/", publisher: "NVIDIA", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://huggingface.co/docs/transformers/en/llm_tutorial_optimization", publisher: "Hugging Face", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://semiengineering.com/packet-based-npus-in-the-llm-era-from-compute-bound-cnns-to-memory-bound-edge-and-automotive-workloads/", publisher: "Semiconductor Engineering", reliabilityTier: "secondary", claimStatus: "reputable_report" },
        { url: "https://semiengineering.com/the-murky-world-of-ai-benchmarks/", publisher: "Semiconductor Engineering", reliabilityTier: "secondary", claimStatus: "reputable_report" },
        { url: "https://mlcommons.org/benchmarks/client/", publisher: "MLCommons", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
        { url: "https://github.com/mlcommons/mlperf_client", publisher: "MLCommons", reliabilityTier: "primary", claimStatus: "confirmed_fact" },
      ],
      body: `Every laptop sold as an "AI PC" now leads with a TOPS figure. It looks like the kind of number you can line up in a row and compare — 38 here, 45 there, 50 over there — and that is exactly the problem. TOPS is a real, calculable quantity, but it is not a standardised one, and two vendors quoting it are frequently not quoting the same thing.

This is not a claim that the vendors are lying. Every number in this article comes from a manufacturer's own published specification page, and they are all defensible on their own terms. The issue is what those terms are, and how rarely they appear next to the number.

## What TOPS literally means

TOPS stands for tera-operations per second — trillions of operations per second. Microsoft spells it out in its own developer documentation as the ability to "perform more than 40 trillion operations per second (TOPS)". Intel uses the identical expansion, "tera operations per second", in its Core Ultra 200V launch materials.

An "operation" here is typically one multiply or one accumulate inside the dense matrix arithmetic that neural networks are built from. The figure is almost always a theoretical peak: the number of such units on the chip, multiplied by how many operations each performs per clock, multiplied by the clock speed. It is a ceiling derived from the silicon's dimensions, not a result anybody measured by running a model.

That matters, because a theoretical peak only means something once you know what kind of operation was being counted.

## The precision problem: one chip, four different headline numbers

The cleanest demonstration of this comes from NVIDIA's own spec page for the Tesla T4, which publishes four separate throughput figures for a single piece of silicon:

- INT4 precision: 260 INT4 TOPS
- INT8 precision: 130 INT8 TOPS
- Mixed precision (FP16/FP32): 65 FP16 TFLOPS
- Single precision (FP32): 8.1 TFLOPS

Nothing changed about the hardware between those four lines. What changed is how many bits each number being multiplied is allowed to occupy. Halve the precision from INT8 to INT4 and the throughput figure doubles exactly, because the same transistors can process twice as many smaller numbers per clock.

The spread from top to bottom is roughly thirty-two-fold. A vendor choosing which of these four rows to put on a marketing slide has enormous latitude, and the row they choose is not always the row that reflects how the chip will actually be used.

Microsoft is unusually direct about why lower precisions dominate NPU marketing. Its NPU documentation states that "AI models are often trained and available in larger data formats, such as FP32. Many NPU devices, however, only support integer math in lower bit format, such as INT8, for increased performance and power efficiency. Therefore, AI models need to be converted (or 'quantized') to run on the NPU."

So an NPU's INT8 figure is genuinely the relevant one for how that NPU works. It just is not comparable to a figure someone else quoted at a different precision — and, as we will see, most vendors do not tell you which one they used.

## The sparsity asterisk

There is a second multiplier hiding in some figures. NVIDIA's data-centre GPUs support what it calls 2:4 structured sparsity — a scheme where, as NVIDIA's own developer blog describes it, "in each contiguous block of four values, two values must be zero". Skipping the guaranteed zeros lets the hardware finish the same effective calculation in half the time, which NVIDIA states as: "For a sparsity of 2x, they can complete the same effective calculation in half the time."

On the A100 specification page, NVIDIA handles this honestly: every tensor figure is printed twice, with a footnote. INT8 Tensor Core is listed as "624 TOPS | 1248 TOPS*", FP16 Tensor Core as "312 TFLOPS | 624 TFLOPS*", and the asterisk resolves to "With sparsity".

Not every page is that careful. NVIDIA's Jetson Orin page headlines its modules as "275 SPARSE INT8 TOPS", "157 SPARSE INT8 TOPS" and "67 SPARSE INT8 TOPS" — properly qualified. Its Jetson modules developer page quotes the very same figures as a bare "up to 275 TOPS", "up to 157 TOPS" and "up to 67 TOPS", with no precision and no sparsity qualifier at all. Same silicon, same numbers, two pages, one of which tells you what you are looking at.

This is not confined to data-centre parts. Intel's ARK entry for the Core Ultra 7 266V lists sparsity support for its NPU. What Intel does not state is whether the NPU TOPS figure it publishes assumes sparsity is switched on — a genuinely material ambiguity that we could not resolve from Intel's published material.

## Who actually tells you the precision

Here is where the four major client silicon vendors stand, taken from their own current product pages:

- Intel, Core Ultra 7 266V: "NPU Peak TOPS (Int8): 48". The precision is in the label itself.
- Qualcomm, Snapdragon X Elite: "up to 45 TOPS AI performance". No precision qualifier anywhere on the page.
- AMD, Ryzen AI 9 HX 370: "NPU TOPS — Up to 50". No precision qualifier anywhere on the page.
- Apple, M4: "capable of an astounding 38 trillion operations per second". No precision qualifier.

One of the four tells you. This is why the reflex of ranking 50 above 48 above 45 above 38 is unsound: only one of those figures arrives with the information you would need to place it on the same axis as the others.

It is worth being precise about the nature of this criticism. INT8 is the widely reported basis for most of these figures, and it may well be the basis for all of them. But "widely reported" is not "published by the vendor", and this article does not assert a precision that a manufacturer declined to state.

There is a coda to this. When Apple announced the M5 in October 2025, it published no TOPS figure at all — not for the Neural Engine, not for the new per-core Neural Accelerators. It described AI performance entirely in relative terms, such as "over 4x peak GPU compute compared to M4". The company that in May 2024 used a TOPS number to claim the M4's Neural Engine was "more powerful than any neural processing unit in any AI PC today" had, by its next generation, stopped quoting the metric.

## The 40 TOPS bar, and what it actually requires

Microsoft's Copilot+ threshold is the most consequential TOPS figure in consumer computing, because it gates a set of Windows features. The requirement, in Microsoft's words, is that "many of the new Windows AI features require an NPU with the ability to run at 40+ TOPS".

Two details in that sentence do a lot of work.

The first is "an NPU". The bar applies to the neural processing unit alone. It is not a whole-system total, and GPU capability does not count toward it.

The second is what is missing: Microsoft never attaches a precision to the 40 TOPS figure, in either its developer documentation or its consumer-facing NPU explainer. The single most important TOPS number in the Windows ecosystem is specified without the unit qualifier that would make it unambiguous.

## "Platform TOPS": why summing is misleading

Some of the largest numbers on AI PC marketing come from adding up every block on the chip that can do matrix maths. Intel is explicit that this is what it is doing, describing "up to 120 total platform TOPS (tera operations per second) across central processing unit (CPU), graphic processing unit (GPU) and neural processing unit (NPU)".

Intel's own spec sheets let you take the sum apart, and the result is instructive:

- Core Ultra 7 266V: Overall 118 TOPS (Int8) = NPU 48 + GPU 66 + roughly 4 from the CPU.
- Core Ultra 5 245K: Overall 30 TOPS (Int8) = NPU 13 + GPU 8 + roughly 9 from the CPU.

On the 266V, the GPU supplies more of the headline figure than the NPU does. The number labelled as the chip's AI performance is, more than half of it, the integrated graphics.

AMD does something structurally similar with less breakdown, listing "Overall TOPS: Up to 80" alongside "NPU TOPS: Up to 50" for the Ryzen AI 9 HX 370 — leaving 30 TOPS attributed to blocks it does not itemise.

The decisive objection to summing is not an editorial opinion; it comes from Microsoft's own rule. Because Copilot+ requires 40+ TOPS *from the NPU*, Intel's Core Ultra 5 245K does not qualify on its 13 TOPS NPU, despite advertising an "Overall" figure of 30. The platform total and the qualifying total are simply different measurements, and no quantity of GPU TOPS substitutes for NPU TOPS under the rule that actually governs the feature set.

## Why TOPS barely predicts local LLM performance

This is the part that matters most if your interest in an NPU is running a language model locally, and it is the point at which TOPS stops being merely ambiguous and starts being close to irrelevant.

TOPS is a compute ceiling. Generating text with a language model is, for the most part, not limited by compute.

NVIDIA's own inference optimisation guide states it plainly: "The speed at which the data (weights, keys, values, activations) is transferred to the GPU from memory dominates the latency, not how fast the computation actually happens. In other words, this is a memory-bound operation." Elsewhere in the same document: "Model execution is frequently memory-bandwidth bound — in particular, bandwidth-bound in the weights."

The reason is the two-phase structure of inference. NVIDIA describes the prefill phase — processing your prompt — as "a matrix-matrix operation that's highly parallelized. It effectively saturates GPU utilization." The decode phase, generating each subsequent token, is different: "Each sequential output token needs to know all the previous iterations' output states (keys and values). This is like a matrix-vector operation that underutilizes the GPU compute ability compared to the prefill phase."

Hugging Face's optimisation documentation describes the same bottleneck from the software side: "For auto-regressive decoding, the required memory bandwidth for the constant reloading can become a serious time bottleneck."

A trade analysis published by Semiconductor Engineering in August 2026 connects this directly to the metric. It argues that classic vision workloads were genuinely compute-bound, but that "LLMs and VLMs change the story", becoming "increasingly memory-bound, not compute-bound" — and concludes that transformer decodes "are now limited by memory behavior — KV cache size, access patterns, and bandwidth — not by the nominal TOPS rating on the datasheet". That piece appears to be a vendor-contributed feature, so it is worth reading as an informed industry argument rather than a neutral survey; but it is consistent with what NVIDIA and Hugging Face say in their own documentation.

The practical consequence: for token generation speed, memory bandwidth and how much of the model fits in fast memory tend to matter more than the accelerator's peak operation count. A chip with an impressive TOPS figure attached to slow, narrow memory can be comfortably beaten by a lower-TOPS part with more bandwidth.

## Is there anything better to look at?

Somewhat. MLCommons maintains MLPerf Client, described as "a benchmark for Windows, Linux and macOS, focusing on client form factors in ML inference scenarios like AI chatbots, image classification, etc." Version 2.0 was released in August 2026.

Two things make it more useful than a TOPS figure. First, its headline metrics are "Time to first token" and "Tokens per second" — which separate precisely the two regimes that a single TOPS number collapses together: prefill, which is compute-bound, and decode, which is not. Second, it runs across a wide range of silicon — AMD Radeon and Ryzen AI, Intel Arc and Core Ultra, NVIDIA GeForce RTX, Qualcomm Snapdragon X and Apple M-series — and includes execution paths that target NPUs specifically.

Two caveats. It measures real workloads such as Llama 3.1 8B Instruct and Phi 4 Mini Instruct, which is a strength, but it is a tool you or a reviewer runs rather than a figure printed on a box. And we could not establish whether MLCommons operates a formal published, audited results database for the client benchmark in the way it does for its server benchmarks — so treat cross-referenced MLPerf Client scores you find online as you would any third-party test result, and check who ran it.

## When this does not matter to you

Most people reading a TOPS figure will never be affected by any of the above, and it is worth saying so clearly.

- If you are buying a laptop for ordinary work — documents, email, browser tabs, video calls — NPU TOPS is close to irrelevant to how the machine will feel. Battery life, screen quality, keyboard, thermals and memory capacity will all matter more, every day.
- If the AI features you care about are the ones that run in a data centre — most chatbot use, most image generation services — your NPU is not involved at all. That work happens on someone else's hardware and your network connection matters more than your silicon.
- If you only want the specific Windows features gated behind Copilot+, the question is binary rather than comparative: does this machine clear Microsoft's 40+ TOPS NPU bar or not? A machine at 45 and a machine at 50 both qualify, and the gap between them is unlikely to be something you notice.
- If you are not running models locally, the memory-bandwidth argument in this article is interesting background and nothing more.

The people for whom this genuinely matters are a narrower group: those intending to run language models or diffusion models on their own machine, those making a purchase they expect to hold for several years on the strength of its AI capability, and anyone comparing two machines where the TOPS figures are close enough that the difference could plausibly be an artefact of precision or sparsity rather than silicon.

## The honest summary

TOPS is not fake. It is a genuine theoretical peak, and within a single vendor's line-up, quoted consistently, it will usually rank parts in the right order.

Across vendors it is far weaker than it looks, for four compounding reasons: it changes with numeric precision, and only Intel currently prints the precision next to the number; it can silently include a sparsity assumption that doubles it; it may be a platform sum in which the GPU contributes more than the NPU; and it measures a compute ceiling for a workload whose real limit is frequently memory bandwidth.

The useful posture is to treat a TOPS figure the way you would treat a car's top speed. It is a real property of the machine, it is measured under conditions you will never encounter, and it tells you very little about what the thing is like to live with.`,
    },
  ],
  tagDefinitions: [
    { slug: "npu", name: "NPU" },
  ],
};
