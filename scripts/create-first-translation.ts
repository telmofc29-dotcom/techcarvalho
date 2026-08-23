// Creates the first genuine translation on this site: the Wi-Fi generations
// guide, in European Portuguese.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/create-first-translation.ts
//   ...                                      npx tsx scripts/create-first-translation.ts --delete
//
// WHY THIS ARTICLE
// ----------------
// It is one of the strongest pieces on the site — 2,600 words, heavily sourced,
// evergreen — and the audit found 51 of 81 articles below their own format
// floor. Translating a thin page would propagate a quality problem into a
// second language. The first translation should be of something worth reading.
//
// WHAT IS AND IS NOT TRANSLATED
// -----------------------------
// Prose is translated to read naturally in Portuguese, not word-for-word.
// Facts are not translated at all: 802.11be, Wi-Fi 6E, WPA3, 1024-QAM, every
// frequency and every date appear unchanged. Quantities ARE localised —
// Portuguese writes 2,4 GHz and 1200, not 2.4 GHz and 1,200 — and
// translation-integrity.ts knows the difference between reformatting a quantity
// (fine) and reformatting a designation (not fine).
//
// DIRECT QUOTATIONS are the delicate case. The English wording of a Wi-Fi
// Alliance or IEEE statement is EVIDENCE, and a translated quotation silently
// presented as the source's own words is a small dishonesty. So the article
// carries an explicit note saying the quotations were translated from English
// originals, and the original sources stay attached to the translation group
// and are listed on the page.
//
// STATUS
// ------
// Created as status='draft', translation_state='needs_review'. It is NOT
// published. A translation into a language the site has never published in
// should be read by a native speaker before it goes live, and this script
// deliberately cannot publish it.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { checkTranslationIntegrity } from "../src/lib/i18n/translation-integrity.ts";

loadEnvLocal();

const SOURCE_SLUG = "wifi-generations-explained-wifi-4-to-wifi-7";
const PT_SLUG = "geracoes-wifi-explicadas-do-wifi-4-ao-wifi-7";

const PT_TITLE = "Do Wi-Fi 4 ao Wi-Fi 7: o que cada geração mudou de facto";

const PT_BODY = `As caixas dos routers vendem um número. Wi-Fi 6, Wi-Fi 6E, Wi-Fi 7 — cada um chega com um algarismo maior à frente e a insinuação de que o anterior já está ultrapassado. Algumas dessas mudanças vai senti-las mesmo. A maioria é engenharia real e completamente invisível numa casa normal. Este artigo explica qual é qual.

*Nota sobre as citações: as declarações da Wi-Fi Alliance e do IEEE citadas neste artigo foram publicadas originalmente em inglês e são aqui traduzidas. As fontes originais estão listadas no fim da página.*

Há duas coisas a estabelecer antes da história, porque quase todas as afirmações erradas sobre gerações de Wi-Fi nascem de as confundir.

## Duas datas diferentes, e o marketing baralha-as

As gerações de Wi-Fi têm dois aniversários.

Um é a emenda do IEEE — a norma de engenharia propriamente dita, publicada pela IEEE Standards Association. O outro é o programa de certificação da Wi-Fi Alliance, o organismo da indústria que detém os nomes do tipo "Wi-Fi 6" e testa a interoperabilidade dos produtos.

Nas gerações recentes, as duas datas não andam perto uma da outra. O IEEE indica a publicação da 802.11ax a 19 de maio de 2021, mas a Wi-Fi Alliance anunciou que "o programa de certificação Wi-Fi CERTIFIED 6 da Wi-Fi Alliance já está disponível" a 16 de setembro de 2019 — cerca de vinte meses antes. O padrão repete-se com o Wi-Fi 7: a certificação chegou a 8 de janeiro de 2024, enquanto o IEEE indica a publicação da 802.11be a 22 de julho de 2025.

Não é um escândalo; os programas de certificação são deliberadamente construídos sobre versões estáveis do rascunho para que a indústria não tenha de esperar anos pela publicação final. Mas significa que "a norma nem sequer estava terminada" é uma crítica comum — e tecnicamente verdadeira — ao hardware inicial de qualquer geração, e que as datas citadas para a mesma geração podem legitimamente divergir em dois anos consoante o acontecimento a que se referem.

A segunda complicação: as próprias páginas de produto da Wi-Fi Alliance dão um terceiro conjunto de anos — dizem que o Wi-Fi 4 "foi introduzido em 2009", o Wi-Fi 5 em 2014, o Wi-Fi 6 em 2018 e o Wi-Fi 7 em 2024. No caso do Wi-Fi 6, "2018" é quando a geração foi baptizada, um ano antes de se poder comprar seja o que for certificado. Sempre que este artigo dá uma data precisa, ela vem dos comunicados da própria Alliance ou dos registos do próprio IEEE, e diz de qual se trata.

## Wi-Fi 4 (2009): quando o Wi-Fi doméstico se tornou normal

O IEEE publicou a 802.11n a 29 de outubro de 2009 como "Emenda 5: melhorias para débito mais elevado". O objetivo de projeto declarado era modesto para os padrões de hoje e vale a pena citá-lo porque dá escala ao resto desta lista: modos de operação "capazes de débitos muito superiores, com um débito máximo de pelo menos 100 Mb/s, medido no ponto de acesso ao serviço de dados MAC".

O resumo que a própria Wi-Fi Alliance faz do Wi-Fi 4 é marketing e não especificação — "desempenho e velocidade melhorados", "alcance alargado por toda a casa", "suporte para muitos utilizadores sem sacrificar a intensidade do sinal" — e a página atual não indica bandas nem larguras de canal, pelo que este artigo também não o fará.

A posição prática hoje: o Wi-Fi 4 é a geração mais antiga que ainda vale a pena tolerar. Uma tomada inteligente ou uma impressora antiga em Wi-Fi 4 não estão a prejudicar nada. Um router Wi-Fi 4 é de outra era da banda larga doméstica, e substituí-lo é um dos poucos casos de atualização genuinamente simples em todo este artigo.

## Wi-Fi 5 (2013/2014): a geração dos 5 GHz, em duas vagas

Os cronogramas do grupo de trabalho 802.11 do IEEE situam a publicação da 802.11ac a 18 de dezembro de 2013; a Wi-Fi Alliance diz que o Wi-Fi 5 "foi introduzido em 2014".

O que é preciso perceber sobre o Wi-Fi 5 é que chegou em duas vagas distintas, e a segunda importa mais do que a maioria das pessoas imagina. O anúncio do programa alargado, feito pela Wi-Fi Alliance em junho de 2016, descreve o que a segunda vaga trouxe: os canais passaram "de 80 MHz para 160 MHz de largura de banda máxima", os fluxos espaciais passaram de três para quatro, e chegou o MU-MIMO — descrito pela Alliance como redes "capazes de multitarefa, enviando dados para vários dispositivos ao mesmo tempo em vez de um de cada vez". A Alliance afirmou que dispositivos com estas características podiam atingir "até três vezes a velocidade de dispositivos que suportem apenas as funcionalidades originais do Wi-Fi CERTIFIED ac".

Ou seja: o MU-MIMO é uma funcionalidade do Wi-Fi 5, não do Wi-Fi 6. Muita cobertura erra nisto.

Uma nota estrutural que explica bastante confusão: a 802.11ac é, em si, uma especificação de 5 GHz. Um "router Wi-Fi 5 de banda dupla" é um rádio Wi-Fi 5 nos 5 GHz ao lado de um rádio de geração anterior nos 2,4 GHz. A própria página de produto da Wi-Fi Alliance reflete a realidade do produto e não a da emenda, observando que "a maioria dos produtos Wi-Fi 5 é de banda dupla, operando nas bandas dos 2,4 GHz e dos 5 GHz".

É também a geração que transformou "o meu dispositivo está nos 2,4 GHz ou nos 5 GHz?" na pergunta de diagnóstico mais útil das redes domésticas — uma pergunta que reaparece no nosso guia de resolução de problemas de Wi-Fi e, inevitavelmente, em quase todos os problemas de configuração de casa inteligente.

## Wi-Fi 6 (certificado em setembro de 2019): eficiência, não velocidade de cartaz

Esta é a geração que mais gente lê mal, porque aquilo que acrescenta tem que ver com gerir muitos dispositivos ao mesmo tempo e não com tornar um dispositivo mais rápido. Do próprio anúncio de certificação da Wi-Fi Alliance:

- o OFDMA "partilha eficazmente os canais para aumentar a eficiência da rede e reduzir a latência"
- o MU-MIMO descendente "permite transferir mais dados em sentido descendente de uma só vez"
- o Target Wake Time "melhora significativamente a autonomia da bateria nos dispositivos Wi-Fi"
- o 1024-QAM "aumenta o débito nos dispositivos Wi-Fi"
- e o programa "exige a mais recente geração de segurança Wi-Fi, o Wi-Fi CERTIFIED WPA3"

Leia-se isso como um todo e a intenção de projeto é inequívoca. O Wi-Fi 6 foi construído para uma casa com quarenta coisas ligadas, não para fazer um portátil descarregar mais depressa. Se o seu agregado tem meia dúzia de dispositivos e nenhum congestionamento, o Wi-Fi 6 está a resolver um problema que você não tem. Se a sua rede é densa e movimentada — um apartamento partilhado, uma casa cheia de equipamento de casa inteligente — é a geração em que a diferença é real, e manifesta-se como consistência sob carga e não como um número maior num teste de velocidade.

A exigência de WPA3 é a mais discreta dessa lista e talvez a mais consequente, por ser um mínimo de segurança e não uma funcionalidade de desempenho. É também, por acaso, uma causa recorrente de dispositivos de casa inteligente que se recusam a entrar num router novo.

O Target Wake Time merece destaque nos dispositivos alimentados a bateria: permite que um dispositivo negoceie quando precisa de estar acordado para falar com o router, em vez de ficar permanentemente à escuta.

## Wi-Fi 6E (baptizado em janeiro de 2020, certificado em janeiro de 2021): espectro novo, o mesmo rádio

O Wi-Fi 6E não é uma geração nova. A Wi-Fi Alliance é explícita: "a certificação Wi-Fi 6E, como parte do Wi-Fi CERTIFIED 6, oferece as funcionalidades e capacidades do Wi-Fi 6, alargadas à banda dos 6 GHz."

O nome foi anunciado a 3 de janeiro de 2020 para que os compradores tivessem forma de identificar dispositivos capazes de usar os 6 GHz assim que os reguladores abrissem a banda. A certificação seguiu-se a 7 de janeiro de 2021, depois da decisão da FCC norte-americana de 23 de abril de 2020 de abrir a banda dos 6 GHz a uso não licenciado — 1200 megahertz dela.

O que esse espectro extra compra, nas palavras da própria Alliance, é espaço: os 6 GHz "resolvem a escassez de espectro Wi-Fi ao fornecer blocos de espectro contíguo capazes de acomodar 14 canais adicionais de 80 MHz e 7 canais adicionais de 160 MHz".

Contíguo é a palavra decisiva. As bandas dos 2,4 e dos 5 GHz estão cheias, fragmentadas pela regulação e partilhadas com todos os vizinhos ao alcance. Os 6 GHz chegaram limpos e largos. É por isso que uma ligação a 6 GHz pode parecer muitíssimo melhor do que uma a 5 GHz num prédio de apartamentos — não porque o rádio seja mais esperto, mas porque ainda ninguém lá está em cima.

A contrapartida é física e não se negoceia: as frequências mais altas atenuam-se mais depressa através de paredes e pavimentos. Uma ligação a 6 GHz é excelente na mesma divisão do router e degrada-se mais depressa do que a de 5 GHz à medida que nos afastamos. Quem vender os 6 GHz como melhoria de cobertura tem a ideia ao contrário.

## O senão dos 6 GHz que ninguém põe na caixa

Quantos 6 GHz pode usar legalmente depende inteiramente de onde vive, e o mundo está dividido em dois patamares.

Segundo o registo regulatório da Wi-Fi Alliance, um grupo de países abriu a totalidade da gama dos 5925 aos 7125 MHz — os 1200 MHz completos — incluindo os Estados Unidos, o Canadá, o Brasil, o México, a Argentina, a Colômbia, o Peru, a Costa Rica, o Panamá, a Guatemala, El Salvador, a República Dominicana, o Cazaquistão, a Arábia Saudita e a Coreia do Sul. Um grupo bastante maior, que inclui os Estados-Membros da UE, o Japão, a Austrália, a Índia, Israel, a Nova Zelândia, Singapura, a África do Sul e os Emirados Árabes Unidos, abriu apenas a porção inferior, dos 5925 aos 6425 MHz — cerca de 500 MHz, bem menos de metade. A Austrália autorizou adicionalmente os 6425 aos 6585 MHz.

A consequência prática: um router Wi-Fi 7 anunciado com canais de 320 MHz precisa de espectro contíguo suficiente nos 6 GHz para os acomodar. Num país que só abriu a parte inferior dos 6 GHz, essa capacidade fica substancialmente limitada por regulação, independentemente do que o hardware saiba fazer. Uma análise escrita para o mercado norte-americano não se transfere para o europeu neste ponto.

O Reino Unido é atualmente um caso genuinamente confuso, e preferimos assinalá-lo a disfarçá-lo. A Wi-Fi Alliance publicou um comunicado a descrever uma decisão do Ofcom de 20 de julho de 2026 que faria do Reino Unido "o primeiro país europeu a permitir o acesso Wi-Fi em toda a banda dos 6 GHz" — acesso isento de licença aos 1200 MHz completos. Não conseguimos ler a declaração do próprio Ofcom para confirmar o pormenor diretamente, pelo que deve ser tratado como reportado e não como verificado aqui. A somar à confusão, o próprio mapa regulatório da Wi-Fi Alliance continua a listar o Reino Unido no patamar mais estreito dos 5925 aos 6425 MHz, contradizendo o seu próprio anúncio. Se está no Reino Unido e isto pesa na sua compra, consulte diretamente o Ofcom em vez de confiar em qualquer resumo secundário, incluindo este.

## Wi-Fi 7 (certificado em janeiro de 2024): canais mais largos, e duas bandas ao mesmo tempo

A Wi-Fi Alliance apresentou o Wi-Fi CERTIFIED 7 a 8 de janeiro de 2024. O IEEE indica a publicação da 802.11be a 22 de julho de 2025, o que, como já se disse, é o padrão habitual e não uma anomalia.

As capacidades de cartaz, nas descrições da própria Alliance:

- canais de 320 MHz "disponíveis na banda dos 6 GHz proporcionam o dobro do débito do Wi-Fi 6". O dobro da largura do canal mais largo do Wi-Fi 6, e só possível nos 6 GHz, porque é a única banda com espaço para isso.
- operação multiligação, "que aumenta o débito e reduz a latência ao permitir que os dispositivos combinem diferentes canais de várias bandas de frequência". A Alliance apresenta também o MLO como suporte para "um balanceamento de carga mais eficiente do tráfego entre ligações, resultando em maior débito e maior fiabilidade".
- 4K QAM, que entrega "taxas de transmissão 20% superiores às do 1024-QAM".
- e ainda multi-RU, 512 compressed block-ack, acesso ascendente despoletado e EPCS.

Destes, a operação multiligação é a ideia genuinamente nova. Até ao Wi-Fi 7, um dispositivo estava ligado a uma banda de cada vez e alternava entre elas, com uma breve interrupção em cada troca. O MLO permite que um dispositivo use mais do que uma ligação em simultâneo. O enquadramento da própria Alliance coloca a "maior fiabilidade" ao lado do débito, e a fiabilidade é a metade que conta no uso real — uma ligação que sobrevive a uma banda ficar momentaneamente má é uma ligação melhor, mesmo que o seu número de pico não mude.

O Wi-Fi 7 também continua a evoluir. A 6 de janeiro de 2026 a Wi-Fi Alliance alargou o programa a dispositivos que só usam 20 MHz, trazendo MLO, MU-MIMO e multi-RU aos rádios de canal estreito usados em hardware de Internet das Coisas — um desenvolvimento significativo para a fiabilidade da casa inteligente que nada tem a ver com velocidade.

## Sobre aqueles números de velocidade de cartaz

Já viu os valores: 600 Mbps para o Wi-Fi 4, vários gigabits para o Wi-Fi 5, 9,6 Gbps para o Wi-Fi 6, dezenas de gigabits para o Wi-Fi 7. Não os publicamos, porque não conseguimos atribuir nem um deles à Wi-Fi Alliance ou ao IEEE. Circulam por toda a parte, estão em termos gerais na ordem de grandeza certa, e são também máximos agregados teóricos que pressupõem larguras de canal, fluxos espaciais e taxas de modulação que nenhum dispositivo doméstico combina na prática.

O que se consegue atribuir a uma fonte são os objetivos de débito do IEEE, que são honestos quanto a serem objetivos: a 802.11n visava "pelo menos 100 Mb/s" medidos no ponto de acesso ao serviço MAC, e a 802.11be exige "pelo menos um modo de operação capaz de suportar um débito máximo de pelo menos 30 Gbit/s". A distância entre esses dois valores ao longo de dezasseis anos é que é a história real; a casa decimal exata numa caixa não é.

## O número que verdadeiramente o limita

A sua norma de Wi-Fi define um teto para a ligação entre o seu dispositivo e o seu router. Não tem efeito nenhum sobre a velocidade da linha que entra no edifício. Se a sua banda larga é de 100 Mbps, um router Wi-Fi 7 não consegue entregar mais do que isso à internet — só pode garantir que a ligação local nunca é o estrangulamento, e o Wi-Fi 5 já não era o estrangulamento a essa velocidade.

O segundo teto de que as pessoas se esquecem é o cliente. Um router Wi-Fi 7 a falar com um portátil Wi-Fi 5 produz uma ligação Wi-Fi 5. Todas as ligações negoceiam para baixo, até ao que ambos os extremos suportam, pelo que um router novo não atualiza nada enquanto os dispositivos que realmente lhe interessam não estiverem também na geração nova.

## Quando isto genuinamente não lhe importa

- A sua ligação à internet é o estrangulamento. Se a sua linha é de algumas centenas de megabits e os seus dispositivos já lá chegam nas divisões que usa, todas as gerações a partir do Wi-Fi 5 são suficientemente rápidas e nenhuma norma nova vai mexer no seu teste de velocidade.
- O seu problema é cobertura, não débito. As zonas mortas têm que ver com paredes, distância e colocação dos pontos de acesso. Uma norma mais recente numa frequência mais alta piora ligeiramente a cobertura, não a melhora. Comece pelas verificações gratuitas do nosso guia de resolução de problemas de Wi-Fi, e trate a rede mesh como uma questão à parte.
- Os seus dispositivos são mais antigos do que o seu router. Comprar Wi-Fi 7 para uma casa de dispositivos Wi-Fi 5 compra uma capacidade futura e nada para hoje.`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

async function main(): Promise<void> {
  const db = (await createAdminClient()) as unknown as Db;
  const remove = process.argv.includes("--delete");

  const { data: source, error: srcErr } = await db
    .from("content_items")
    .select("id, slug, title, body, type, category_id, search_intent, translation_group_id, translatable_revision")
    .eq("slug", SOURCE_SLUG)
    .eq("locale", "en")
    .single();
  if (srcErr) throw new Error(`reading the source article failed: ${srcErr.message}`);

  if (remove) {
    const { error } = await db.from("content_items").delete().eq("slug", PT_SLUG).eq("locale", "pt");
    if (error) throw new Error(`delete failed: ${error.message}`);
    const { data: left } = await db.from("content_items").select("id").eq("slug", PT_SLUG);
    console.log(`deleted. remaining rows with that slug: ${((left ?? []) as unknown[]).length}`);
    return;
  }

  // The mechanical check, before anything is written. A translation that
  // mangled a frequency should never reach the database.
  const integrity = checkTranslationIntegrity(source.body ?? "", PT_BODY);
  console.log(`Integrity: ${integrity.sourceTokens} protected tokens in the source, ${integrity.missing.length} missing.`);
  if (!integrity.clean) {
    for (const m of integrity.missing) console.log(`  MISSING  [${m.kind}] ${m.token}`);
    throw new Error("Refusing to write a translation that dropped a protected token.");
  }

  const { data: existing } = await db
    .from("content_items").select("id").eq("slug", PT_SLUG).eq("locale", "pt").maybeSingle();
  if (existing) {
    console.log(`Already exists (${existing.id}). Nothing written. Use --delete to remove it.`);
    return;
  }

  const { data: created, error } = await db
    .from("content_items")
    .insert({
      type: source.type,
      title: PT_TITLE,
      slug: PT_SLUG,
      body: PT_BODY,
      // NOT published, and this script has no code path that publishes.
      status: "draft",
      locale: "pt",
      translation_group_id: source.translation_group_id,
      source_content_id: source.id,
      source_revision_seen: source.translatable_revision,
      translation_state: "needs_review",
      translated_at: new Date().toISOString(),
      category_id: source.category_id,
      search_intent: source.search_intent,
      // primary_query and intent_fingerprint are deliberately left NULL: a
      // Portuguese article does not compete for an English query, and a copied
      // fingerprint would trip the cannibalisation check against its own source.
    })
    .select("id, slug, locale, status, translation_state, translation_group_id, source_revision_seen")
    .single();
  if (error) throw new Error(`insert failed: ${error.code} ${error.message}`);

  console.log("\nCreated:", JSON.stringify(created, null, 2));
  console.log(`\nWords: EN ${(source.body ?? "").split(/\s+/).filter(Boolean).length}  PT ${PT_BODY.split(/\s+/).filter(Boolean).length}`);
  console.log("\nStatus is DRAFT and translation_state is needs_review.");
  console.log("A native speaker should read it before it is published; the integrity check");
  console.log("only proves no fact was mangled, not that the Portuguese reads well.");
}

main().catch((e) => {
  console.error("failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
