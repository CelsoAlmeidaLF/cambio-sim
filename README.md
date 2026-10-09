# Câmbio — Conversor de Moedas & Simulador VET (PWA)

> Aplicação web progressiva (PWA) client-side, offline-first, para monitoramento de taxas de câmbio em tempo real, conversão bidirecional, simulação de Valor Efetivo Total (VET / IOF / Spread), alertas de cotação com notificações Web Push e gráficos históricos interativos.

---

## Sumário

- [Visão Geral](#visão-geral)
- [Funcionalidades Principais](#funcionalidades-principais)
- [Segurança & Hardening](#segurança--hardening)
- [Simulador VET (Valor Efetivo Total)](#simulador-vet-valor-efetivo-total)
- [Arquitetura & Estrutura](#arquitetura--estrutura)
- [Testes Automatizados](#testes-automatizados)
- [Como Executar](#como-executar)
- [Licença](#licença)

---

## Visão Geral

O **Câmbio** é um aplicativo financeiro responsivo desenvolvido com foco em desempenho, segurança estrita e usabilidade offline-first. Não exige credenciais nem servidores intermediários proprietários, comunicando-se diretamente com APIs de mercado financeiro em tempo real e guardando configurações e históricos exclusivamente no dispositivo do usuário.

---

## ✨ Funcionalidades Principais

- **Cotações em Tempo Real & Suporte Multimoedas**:
  - Dólar Americano (`USD`), Euro (`EUR`), Bitcoin (`BTC`), Libra Esterlina (`GBP`), Dólar Canadense (`CAD`) e Peso Argentino (`ARS`).
  - Spread comercial de compra (Bid) e venda (Ask), variação diária percentual e máximas/mínimas do dia.
  - Atualização automática a cada 5 minutos com mecanismo de resiliência a falhas de rede e timeout com `AbortController`.
- **Gráficos Sparkline Interativos**:
  - Séries históricas de **7 Dias**, **30 Dias**, **90 Dias** e **1 Ano**.
  - Renderização vetorial SVG com gradientes e tooltip interativo ao passar o cursor ou o dedo sobre os pontos históricos.
- **Conversor Rápido Bidirecional**:
  - Conversão instantânea de moeda estrangeira para BRL (pela compra) ou de BRL para moeda estrangeira (pela venda) com botão de inversão rápida (`⇄`).
  - Histórico das últimas conversões mantido localmente.
- **Simulador de VET (Custo Efetivo Real)**:
  - Permite ao usuário simular compras de moeda para viagem, cartões internacionais ou transferências bancárias, discriminando o impacto do **Spread bancário**, do **IOF** e das **tarifas**.
- **Alertas de Cotação & Web Notifications**:
  - Disparo de avisos visuais e notificações push no navegador quando a cotação romper o limite mínimo ou máximo configurado pelo usuário.
- **PWA & Suporte Offline**:
  - Cache resiliente através de Service Worker com política cache-first para os recursos estáticos e network-only para cotações em tempo real.

---

## Segurança & Hardening

1. **Content Security Policy (CSP) Estrita**:
   - Declarada via meta tag bloqueando injeção de scripts não autorizados (`default-src 'self'; script-src 'self'; ...`).
2. **Prevenção de XSS Baseado em DOM**:
   - Histórico e gráficos gerados exclusivamente através da API segura do DOM (`document.createElement`, `textContent`, `document.createDocumentFragment` e SVG Namespace), eliminando concatenações de HTML vulneráveis.
3. **Validação de Schemas & Sanitização**:
   - Os dados lidos do `localStorage` passam por validação estrutural (`validateAlerts`, `validateConversionLog`).
   - Os payloads vindos de APIs externas são normalizados e auditados (`validateApiQuote`) contra entradas malformadas.
4. **Cofre local por PIN**:
   - Alertas e histórico de conversões ficam em um cofre AES-256-GCM protegido por PIN numérico de seis dígitos.
   - PBKDF2-SHA-256 com 600.000 iterações protege a chave de dados, que permanece apenas na memória da sessão.
   - A migração remove a chave AES exportável usada pela versão anterior somente depois de confirmar a gravação no novo cofre.
5. **Sessão e recuperação**:
   - Bloqueio automático após 15 minutos e atraso progressivo após PIN incorreto.
   - 12 palavras (ou o código de 12 caracteres equivalente) redefinem o PIN de todos os apps; PDF para imprimir e consulta em Configurações com o PIN.
6. **Timeouts & Tolerância a Falhas**:
   - Todas as requisições HTTP usam limite de tempo via `AbortController`, impedindo bloqueio de interface em conexões instáveis.

---

## Simulador VET (Valor Efetivo Total)

O VET é o custo total em reais dividido pela quantia em moeda estrangeira, incluindo tarifas e tributos (lógica da Res. BCB 277/2022):

```
Câmbio com spread = Cotação de venda × (1 + Spread%)
IOF               = Câmbio com spread × alíquota
Tarifas           = tarifa fixa (R$) + tarifa % × Câmbio com spread
Total a pagar     = Câmbio com spread + IOF + Tarifas
VET               = Total a pagar ÷ quantia em moeda estrangeira
```

- Os cálculos usam aritmética decimal exata e só o resultado final é arredondado a centavos (meio para cima). As parcelas fecham com o total: valor sem spread + spread + IOF + tarifas = total.
- Escalas: **spread e tarifa percentual em %** (1,5 = 1,5%); **alíquota de IOF em decimal** (0,035 = 3,5%). Spread aceito de 0 a 20%; alíquota de 0 a 0,1. Entrada inválida mostra erro (nenhum valor padrão é aplicado em silêncio).
- **Spread padrão por modalidade** (estimativa de mercado, não norma; cada instituição define o seu): espécie 5,5%, cartão 4%, conta/remessa 2%, investimento e ingresso 1,5%. Ao trocar a modalidade, o spread volta ao padrão dela.
- **Espécie**: usa a cotação turismo (venda) da AwesomeAPI (`USD-BRLT`, `EUR-BRLT`) quando disponível; ela já embute a margem da espécie e o spread adicional padrão passa a 0%. Para as demais moedas ou se a cotação falhar, usa a comercial + spread padrão de espécie e avisa.
- **Bitcoin**: o simulador VET fica bloqueado (incidência de IOF sobre criptoativos a confirmar com tributarista; Res. BCB 519 a 521/2025).
- **Fonte reserva**: se a cotação veio da fonte reserva (média diária, sem compra/venda), o modal exibe aviso.
- **Cartão**: aviso de que a conversão depende do fechamento/pagamento da fatura.
- **Conversor**: estrangeira para BRL usa a compra (bid); BRL para estrangeira usa a venda (ask). O resultado em R$ sai com 2 casas.
- **Números digitados**: `5,40`, `5.40`, `1.250,50` e `1,234.56` são aceitos; ponto seguido de exatamente 3 dígitos (`1.234`) é milhar; texto inválido (`12abc`) é rejeitado.

### Tabela de Alíquotas de IOF configuradas (Decreto 12.499/2025, vigente desde 11/06/2025; verificado em 30/09/2026):
| Modalidade | Alíquota de IOF |
| :--- | :--- |
| Moeda em Espécie | **3,50%** |
| Cartão Internacional (Crédito/Débito) | **3,50%** |
| Conta Internacional Própria (mesma titularidade) | **3,50%** |
| Remessa Internacional para Terceiros | **3,50%** |
| Remessa para Investimento no Exterior (recursos próprios do residente; a instituição pode exigir declaração da finalidade) | **1,10%** |
| Ingresso de recursos do exterior (inciso XXV; enquadramento a confirmar) | **0,38%** |
| Isenção / Comercial Puro | **0,00%** |

> Aviso: as simulações não são oferta nem orientação tributária. O VET vinculante é o informado pela instituição antes de fechar a operação. Para criptoativos, remessas a terceiros ou investimento, consulte um contador ou tributarista.
>
> Histórico de correções: veja [docs/auditoria-financeira-2026-09.md](docs/auditoria-financeira-2026-09.md).

---

## Arquitetura & Estrutura

```
cambio-sim/
├── LICENSE
├── README.md
├── docs/
│   └── auditoria-financeira-2026-09.md
├── test/
│   ├── cambio-engine.test.js     # Testes do motor financeiro (Node.js nativo)
│   ├── auditoria-financeira.test.js  # Testes das correções da auditoria de 30/09/2026
│   ├── app-ui.test.js            # Integração da interface com DOM falso
│   └── ...                       # quote-sources, financ-id, HTML/versão
└── src/
    ├── index.html                # Ponto de entrada PWA com CSP
    ├── cambio-app.html           # Espelho de compatibilidade
    ├── manifest.json             # Manifesto PWA
    ├── sw.js                     # Service Worker v2 (Cache e offline)
    ├── css/
    │   └── style.css             # Design tokens e folhas de estilo
    └── js/
        ├── cambio-engine.js      # Motor financeiro desacoplado e funções puras
        └── app.js                # Controlador de UI, DOM e eventos
```

---

## Testes Automatizados

O projeto conta com suíte de testes unitários nativa (sem dependências externas):

```bash
node --test test/
```

Os testes cobrem:
- Conversão monetária bidirecional.
- Cálculos de VET, custos de IOF e Spreads bancários.
- Validação e sanitização de dados do `localStorage` e payloads de API externa.
- Verificação de disparos de alertas.
- Parse numérico estrito, arredondamento half-up, fechamento das parcelas do VET, validação de entradas e bloqueio de BTC.
- Interface (conversor e modal VET) com DOM falso.

---

## Como Executar

Por ser uma aplicação estática client-side com Service Worker, sirva os arquivos a partir de qualquer servidor web local:

```bash
# Com Python 3
cd src
python3 -m http.server 8080

# Ou com npx serve
npx serve src
```

Acesse em seu navegador `http://localhost:8080`.
