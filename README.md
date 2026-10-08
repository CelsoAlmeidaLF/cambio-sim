# Câmbio — Conversor de Moedas & Simulador VET (PWA)

> Aplicação web progressiva (PWA) client-side, offline-first, para monitoramento de taxas de câmbio em tempo real, conversão bidirecional, simulação de Valor Efetivo Total (VET / IOF / Spread), alertas de cotação com notificações Web Push e gráficos históricos interativos.

---

## Sumário

- [Visão Geral](#visão-geral)
- [Funcionalidades Principais](#funcionalidades-principais)
- [Segurança & Hardening](#segurança--hardening)
- [Simulador VET (Valor Efetivo Total)](#simulador-vet-valor-efetivo-total)
- [Apoio, avaliação e log de erros](#apoio-avaliação-e-log-de-erros)
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
   - Bloqueio automático após 15 minutos, atraso progressivo após PIN incorreto e código de recuperação exibido uma única vez.
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

## Apoio, avaliação e log de erros

- `src/apoio/` traz cópias de `PACOTES/stk-pkg-doacao/shared/` (não editar aqui), com id `CAMBIO`.
- **Menu ⋮ → Apoiar · Avaliar · Sugerir:** doação (Pix e Bitcoin), nota de 1 a 5 e sugestão. Vai para o Firestore `systekna-feedback`, protegido por App Check.
- **Configurações → Relatórios de erro** (`stk-pkg-erros.js`, primeiro script do `<head>`): guarda no aparelho os últimos erros. Valores, e-mails, textos e parâmetros de URL viram `***` antes de guardar. Dá para ver, copiar, enviar e limpar.
- **Envio só com permissão:** com o **Modo testador** ligado (vale para todos os apps do aparelho), o app envia sozinho. Desligado, pergunta "Enviar relatório?" uma vez por sessão. O dono lê na aba **Erros** do painel de feedback.
- Nenhum dado financeiro sai do aparelho. Só a avaliação, a sugestão e o relatório técnico de erro são enviados.

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
│   ├── quote-sources.test.js     # Fontes de cotação e fonte reserva
│   ├── financ-id.test.js         # PIN e certificado FINANC compartilhados
│   ├── release-html.test.js      # Versão igual no HTML, no espelho e no service worker
│   ├── apoio.test.js             # Painel de apoio: CSP, Firebase e App Check
│   └── stk-pkg-erros.test.js     # Log de erros: limpeza antes do envio
└── src/
    ├── index.html                # Ponto de entrada PWA com CSP
    ├── cambio-app.html           # Espelho de compatibilidade
    ├── manifest.json             # Manifesto PWA
    ├── sw.js                     # Service Worker (cache com a versão do app, offline)
    ├── stk-pkg-secure-vault.js   # Cofre AES-GCM (cópia de PACOTES/stk-pkg-security)
    ├── stk-pkg-secure-ui.js/.css # PIN, bloqueio e Configurações (cópia)
    ├── stk-pkg-financ-icons.js   # Ícones (cópia)
    ├── apoio/                    # Painel de apoio e log de erros (cópia de PACOTES/stk-pkg-doacao)
    ├── css/
    │   └── style.css             # Design tokens e folhas de estilo
    └── js/
        ├── cambio-engine.js      # Motor financeiro desacoplado e funções puras
        ├── quote-sources.js      # Fontes reserva de cotação (currency-api, Frankfurter, Binance)
        └── app.js                # Controlador de UI, DOM e eventos
```

Versão atual: **1.11.0**. Ao mudar o app, troque `data-vault-version` no `index.html` e no `cambio-app.html` e o `CACHE` do `sw.js`.

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
- Versão consistente entre HTML e service worker, CSP do painel de apoio e limpeza do log de erros.

Situação em 08/10/2026: 96 testes passando.
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
