# Auditoria financeira de 30/09/2026 — correções (versão 1.8.0)

Branch: `fix/auditoria-financeira` (a partir de `origin/main`). Versão: `data-vault-version` 1.7.1 → 1.8.0 em `src/index.html` e `src/cambio-app.html` (espelho), cache do service worker `cambio-app-v1.8.0` em `src/sw.js`.

Testes: `node --test test/`. Arquivos novos: `test/auditoria-financeira.test.js` (motor), `test/app-ui.test.js` (interface com DOM falso), `test/release-html.test.js` (HTML, disclaimer e versão).

Legenda de status: **corrigido**; **parcial**; **pendente de validação** (implementado, mas depende de confirmação externa, com o contador abaixo).

## Resumo

| ID | Tema | Status |
| :-- | :-- | :-- |
| C1 | Parse numérico | corrigido |
| A2 | Spread padrão por modalidade | corrigido; valores padrão pendentes de validação (1) |
| A3 | Tarifas no VET | corrigido |
| A4 | BTC no VET | corrigido; incidência de IOF pendente de validação (2) |
| A5 | Aviso de fonte reserva | corrigido |
| M6 | Conversor bid/ask e 2 casas | corrigido |
| M7 | Arredondamento | corrigido |
| M8 | Parcelas fecham com o total | corrigido |
| M9 | Validação de entradas | corrigido |
| M10 | Escala do IOF | corrigido |
| B11 | Nota do 1,1% e opção 0,38% | corrigido; enquadramento do inciso XXV pendente de validação (3) |
| B12 | `iofPercent` com ruído | corrigido |
| B13 | Aviso de cartão | corrigido |
| B14 | Cotação turismo | parcial (4) |
| Disclaimer | Rodapé e modal | corrigido; texto jurídico pendente de revisão (5) |

Pendências de validação (contador: 5):

1. Os spreads padrão (espécie 5,5%, cartão 4%, conta/remessa 2%, investimento/ingresso 1,5%) são estimativas de mercado escolhidas dentro das faixas da auditoria. Não são norma e a interface diz isso. Convém revisar periodicamente com cotações reais de instituições.
2. Se o IOF de espécie (3,5%) ou outra regra se aplica a criptoativos (Res. BCB 519 a 521/2025) deve ser confirmado com tributarista. Enquanto isso o VET fica bloqueado para BTC.
3. A alíquota de 0,38% para ingresso de recursos (inciso XXV) foi adicionada conforme a auditoria. Ela descreve fluxo de entrada (não compra de moeda); o enquadramento e o texto de ajuda precisam ser validados com contador.
4. Ver B14: só USD e EUR têm par turismo na AwesomeAPI.
5. Revisão do texto do disclaimer por quem responde juridicamente pelo app.

## Detalhe por item

### C1 — parse removia todos os pontos
- **Problema**: `parseLocaleNumber` removia todo ponto: "5.40" virava 540, "1000.50" virava 100050, "1,234.56" virava 1,23456 e "12abc" virava 12.
- **Correção**: regex estrito por formato. Vírgula decimal (`5,40`), milhar pt-BR (`1.250,50`), ponto decimal quando não há vírgula e não casa com milhar (`5.40`, `1000.50`), en-US inequívoco (`1,234.56`). Ponto é milhar só em `^[1-9]\d{0,2}(\.\d{3})+$` (`1.234` = 1234; `0.500` = 0,5). Qualquer outro texto devolve NaN. Observação: `1.000` é lido como mil (ambiguidade inerente, documentada no código).
- **Arquivo/função**: `src/js/cambio-engine.js` → `parseLocaleNumber`.
- **Teste**: `test/auditoria-financeira.test.js` → "C1 - parseLocaleNumber estrito"; UI: `test/app-ui.test.js` (conversor com `5.18` e `12abc`).
- **Status**: corrigido.

### A2 — spread padrão de 1,5% subestimava
- **Problema**: padrão único de 1,5% (motor, `app.js`, `index.html`).
- **Correção**: `SPREAD_DEFAULTS` por modalidade (espécie 5,5%, cartão 4%, conta própria/terceiros 2%, investimento/ingresso/sem IOF 1,5%) e `defaultSpreadPercent(modo)`. O campo de spread recebe o padrão da modalidade e volta a ele ao trocar a modalidade (se o usuário editou o spread, a edição é mantida enquanto não trocar de modalidade). Texto na tela: "Padrão estimado para a modalidade. É estimativa de mercado, não é norma". Com base turismo na espécie, o padrão adicional é 0% (evita contar a margem duas vezes).
- **Arquivo/função**: `cambio-engine.js` (`SPREAD_DEFAULTS`, `defaultSpreadPercent`, `calculateVET`), `app.js` (`updateVET`), `index.html` (`#vet-spread`, `#vet-spread-hint`).
- **Teste**: "A2 - spread padrão por modalidade" (motor); "UI VET (A2/B13)" (interface).
- **Status**: corrigido; valores padrão pendentes de validação (1).

### A3 — VET sem tarifas
- **Problema**: VET ignorava tarifas.
- **Correção**: opções `feeFixedBrl` (R$) e `feePercent` (% sobre o câmbio com spread; 0 a 20). VET = total em R$ (câmbio com spread + IOF + tarifas) ÷ quantia em moeda estrangeira (lógica da Res. BCB 277/2022, sem citar artigo). A tarifa fica fora da base do IOF (o IOF incide sobre o valor da operação de câmbio). `vetRate` é calculado com valores exatos (sem o erro de arredondar antes); `vetRate × quantia` difere do total exibido em no máximo 1 centavo. Novos campos na tela: tarifa fixa e percentual, "Valor sem spread", "Tarifas", "VET (total ÷ quantia)".
- **Arquivo/função**: `cambio-engine.js` → `calculateVET`; `index.html`; `app.js` → `updateVET`.
- **Teste**: "A3 - VET com tarifas" (motor); "UI VET (A3)" (interface).
- **Status**: corrigido.

### A4 — VET aplicava IOF de espécie ao BTC
- **Correção**: bloqueio. `vetAvailability('BTC')` devolve `ok: false` com motivo (Res. BCB 519 a 521/2025; incidência a confirmar com tributarista); `calculateVET({currency:'BTC'})` devolve `null`; na tela os campos ficam desabilitados, os resultados mostram "—" e o aviso aparece no modal.
- **Arquivo/função**: `cambio-engine.js` → `vetAvailability`, `calculateVET`, `getVetWarnings`; `app.js` → `updateVET`.
- **Teste**: "A4 - VET bloqueado para BTC" (motor); "UI VET (A4)" (interface).
- **Status**: corrigido; incidência fiscal pendente de validação (2).

### A5 — fonte reserva sem aviso no modal VET
- **Problema**: a currency-api devolve bid = ask = média diária; o aviso existia só no rodapé de status da página.
- **Correção**: `isFallbackQuote` reconhece a cotação da fonte reserva (nome "fonte reserva") e `getVetWarnings` inclui o aviso, exibido dentro do modal. O formato da cotação reserva não foi alterado (bid = ask continua sendo limitação da fonte).
- **Arquivo/função**: `cambio-engine.js` → `isFallbackQuote`, `getVetWarnings`; `app.js` → `renderVetWarnings`.
- **Teste**: "A5 - aviso de fonte reserva" (motor); "UI VET (A5)" (interface simulando AwesomeAPI fora do ar).
- **Status**: corrigido.

### M6 — conversor usava a compra nos dois sentidos
- **Correção**: `convertQuoted`: estrangeira → BRL usa a compra (bid); BRL → estrangeira usa a venda (ask). Resultado em R$ com exatamente 2 casas (half-up); o campo de entrada em BRL do histórico também usa 2 casas.
- **Arquivo/função**: `cambio-engine.js` → `convertQuoted`; `app.js` → `updateConversion`, `handleAddCurrentConversion`.
- **Teste**: "M6 - conversor usa o lado certo da cotação" (motor); "UI conversor (M6)" (interface).
- **Status**: corrigido.

### M7 — erro de arredondamento em ponto flutuante
- **Problema**: `Math.round(x*100)/100` erra 1,005; taxa com spread arredondada a 6 casas antes de multiplicar (ARS 0,00412345 × 1.000.000: 4.331,48 em vez de 4.331,79).
- **Correção**: `calculateVET` usa BigInt em escala 10^12 (a partir da expansão decimal do número, não da binária) e arredonda só no final, half-up explícito. Nova `roundHalfUp(x, casas)` exportada. O IOF é calculado sobre o subtotal já arredondado em centavos.
- **Arquivo/função**: `cambio-engine.js` → `scaled`, `rdiv`, `roundHalfUp`, `calculateVET`.
- **Teste**: "M7 - arredondamento half-up e precisão" (1,005; 2,675; ARS 1.000.000 = 4.331,79; meio centavo do IOF sobe).
- **Status**: corrigido.

### M8 — parcelas não fechavam com o total
- **Correção**: custo do spread = subtotal arredondado − base arredondada; IOF e tarifas em centavos inteiros; total = soma das parcelas. Vale por construção. Novo campo `baseBrl`, `subtotalBrl`, `feeCostBrl`.
- **Arquivo/função**: `cambio-engine.js` → `calculateVET`.
- **Teste**: "M8 - parcelas fecham com o total" (caso 3,37 USD a 5,4317 com spread 2,7% e varredura de 720 combinações).
- **Status**: corrigido.

### M9 — entradas inválidas viravam valor padrão em silêncio
- **Problema**: quantia vazia/0 virava 1000, spread inválido virava 1,5, sem teto de spread, NaN propagava e negativo gerava custo negativo.
- **Correção**: o motor devolve `null` para quantia ≤ 0, > 1e12 ou não numérica, cotação inválida, spread NaN/negativo/acima de 20%, tarifa inválida, modalidade desconhecida. A interface valida antes, mostra a mensagem de erro em `#vet-error` e limpa os resultados. `LIMITS` exportado.
- **Arquivo/função**: `cambio-engine.js` → `calculateVET`, `LIMITS`; `app.js` → `updateVET`.
- **Teste**: "M9 - validação de entradas do VET" (motor); "UI VET (M9)" (9 combinações inválidas na interface).
- **Status**: corrigido.

### M10 — escala do IOF
- **Correção**: `iofRate` numérico só é aceito em [0, 0,1] (3.5 é rejeitado, devolvendo `null`). Escalas documentadas no código e no README: spread e tarifa percentual em %, alíquota de IOF em decimal.
- **Arquivo/função**: `cambio-engine.js` → `calculateVET`, comentário em `IOF_RATES`.
- **Teste**: "M10 - escala do IOF".
- **Status**: corrigido.

### B11 — opção de 1,1% sem nota e falta de 0,38%
- **Correção**: rótulo "Remessa para Investimento, recursos próprios (IOF 1,1%)" e aviso: vale para recursos próprios do residente com finalidade de investimento; a instituição pode exigir declaração; fora disso o IOF é 3,5%. Nova modalidade `ingresso_recursos` (0,38%, inciso XXV) com aviso de que é fluxo de entrada.
- **Arquivo/função**: `cambio-engine.js` → `IOF_RATES`, `getVetWarnings`; `index.html` (`#vet-iof`).
- **Teste**: "B11 / B13 / B14 - avisos por modalidade"; `test/release-html.test.js` (opção 0,38% e coerência select × tabela).
- **Status**: corrigido; enquadramento do inciso XXV pendente de validação (3).

### B12 — `iofPercent` = 3,5000000000000004
- **Correção**: `iofPercent = roundHalfUp(iof * 100, 6)`.
- **Arquivo/função**: `cambio-engine.js` → `calculateVET`.
- **Teste**: "B12 - iofPercent sem ruído de ponto flutuante" (3,5; 1,1; 0,38).
- **Status**: corrigido.

### B13 — cartão sem aviso de data de conversão
- **Correção**: aviso no modal quando a modalidade é cartão: a conversão depende da data de fechamento/pagamento da fatura; a cotação de hoje é estimativa.
- **Arquivo/função**: `cambio-engine.js` → `getVetWarnings`; `app.js` → `renderVetWarnings`.
- **Teste**: "B11 / B13 / B14 - avisos por modalidade"; "UI VET (A2/B13)".
- **Status**: corrigido.

### B14 — espécie sem cotação turismo
- **Correção**: `fetchTourist` busca `USD-BRLT,EUR-BRLT` na AwesomeAPI a cada atualização (falha isolada: não afeta a cotação principal nem marca a API como fora do ar). `validateTouristQuote` valida faixa plausível e relação com a venda comercial (0,98× a 1,3×). Na espécie o VET usa a venda turismo (spread adicional padrão 0%). Sem turismo, cai na comercial + spread padrão de espécie com aviso.
- **Limitação verificada em 30/09/2026**: a AwesomeAPI só publica turismo para USD e EUR (GBP-BRLT, CAD-BRLT e ARS-BRLT retornam `CoinNotExists`). Para GBP, CAD e ARS vale o fallback com aviso. Não há fonte reserva para turismo.
- **Arquivo/função**: `cambio-engine.js` → `TOURIST_PAIRS`, `validateTouristQuote`; `app.js` → `fetchTourist`, `updateVET`.
- **Teste**: "B14 - validação da cotação turismo" (motor); "UI VET (B14)" (com e sem turismo).
- **Status**: parcial (4): cobre USD e EUR; as demais moedas usam o fallback.

### Disclaimer
- **Correção**: rodapé ampliado (simulação não é oferta nem orientação tributária; VET vinculante é o da instituição; alíquotas do Decreto 12.499/2025 "verificado em 30/09/2026"; consultar contador/tributarista para cripto, remessas a terceiros e investimento) e parágrafo no modal VET com a fórmula e o mesmo aviso. A Res. BCB 277/2022 é citada sem artigo.
- **Arquivo**: `src/index.html` (e espelho `src/cambio-app.html`), `src/css/style.css`.
- **Teste**: `test/release-html.test.js`.
- **Status**: corrigido; texto pendente de revisão (5).

## Outras alterações
- `README.md`: seção do simulador VET (fórmula, escalas, spreads padrão, turismo, BTC, parse), tabela de IOF (0,38%, nota do 1,1%), estrutura e comando de testes.
- Estilos novos em `src/css/style.css` (`.field-hint`, `.vet-warnings`, `.vet-disclaimer`, `.footer-disclaimer`).
- Não alterados: `../stk-pkg-security/`, `../.documents/`, arquivos `secure-*` de `src/`, alíquotas do Decreto 12.499/2025 (3,5% e 1,1%), base na cotação de venda, faixas plausíveis de cotação, `quote-sources.js`.

## Pontos de atenção (fora do escopo)
- A cotação da fonte reserva (currency-api) continua com bid = ask; o aviso mitiga, mas não elimina a limitação.
- O aviso e a base turismo dependem de a AwesomeAPI responder; são atualizados a cada 5 minutos junto com a cotação.
