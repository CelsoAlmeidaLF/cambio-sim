# 💱 Câmbio — Conversor de Moedas & Simulador VET (PWA)

> Aplicação web progressiva (PWA) client-side, offline-first, para monitoramento de taxas de câmbio em tempo real, conversão bidirecional, simulação de Valor Efetivo Total (VET / IOF / Spread), alertas de cotação com notificações Web Push e gráficos históricos interativos.

---

## 📋 Sumário

- [Visão Geral](#-visão-geral)
- [Funcionalidades Principais](#-funcionalidades-principais)
- [Segurança & Hardening](#-segurança--hardening)
- [Simulador VET (Valor Efetivo Total)](#-simulador-vet-valor-efetivo-total)
- [Arquitetura & Estrutura](#-arquitetura--estrutura)
- [Testes Automatizados](#-testes-automatizados)
- [Como Executar](#-como-executar)
- [Licença](#-licença)

---

## 🌟 Visão Geral

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
  - Conversão instantânea de moeda estrangeira para BRL ou de BRL para moeda estrangeira com botão de inversão rápida (`⇄`).
  - Histórico das últimas conversões mantido localmente.
- **Simulador de VET (Custo Efetivo Real)**:
  - Permite ao usuário simular compras de moeda para viagem, cartões internacionais ou transferências bancárias, discriminando o impacto do **Spread bancário** e do **IOF**.
- **Alertas de Cotação & Web Notifications**:
  - Disparo de avisos visuais e notificações push no navegador quando a cotação romper o limite mínimo ou máximo configurado pelo usuário.
- **PWA & Suporte Offline**:
  - Cache resiliente através de Service Worker com política cache-first para os recursos estáticos e network-only para cotações em tempo real.

---

## 🔒 Segurança & Hardening

1. **Content Security Policy (CSP) Estrita**:
   - Declarada via meta tag bloqueando injeção de scripts não autorizados (`default-src 'self'; script-src 'self'; ...`).
2. **Prevenção de XSS Baseado em DOM**:
   - Histórico e gráficos gerados exclusivamente através da API segura do DOM (`document.createElement`, `textContent`, `document.createDocumentFragment` e SVG Namespace), eliminando concatenações de HTML vulneráveis.
3. **Validação de Schemas & Sanitização**:
   - Os dados lidos do `localStorage` passam por validação estrutural (`validateAlerts`, `validateConversionLog`).
   - Os payloads vindos de APIs externas são normalizados e auditados (`validateApiQuote`) contra entradas malformadas.
4. **Timeouts & Tolerância a Falhas**:
   - Todas as requisições HTTP usam limite de tempo (timeout via `AbortController`), impedindo bloqueio de interface em conexões instáveis.

---

## 📊 Simulador VET (Valor Efetivo Total)

O VET é calculado de acordo com as normas cambiais do Banco Central do Brasil:

$$VET = \text{Taxa Base} \times (1 + \text{Spread}_{\%}) \times (1 + IOF)$$

### Tabela de Alíquotas de IOF configuradas:
| Modalidade | Alíquota de IOF |
| :--- | :--- |
| Moeda em Espécie | **1,10%** |
| Cartão Internacional (Crédito/Débito) | **4,38%** |
| Conta Internacional Própria (mesma titularidade) | **1,10%** |
| Remessa Internacional para Terceiros | **0,38%** |
| Isenção / Comercial Puro | **0,00%** |

---

## 📁 Arquitetura & Estrutura

```
cambio-sim/
├── LICENSE
├── README.md
├── test/
│   └── cambio-engine.test.js     # Suíte de testes automatizados (Node.js nativo)
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

## 🧪 Testes Automatizados

O projeto conta com suíte de testes unitários nativa (sem dependências externas):

```bash
node --test test/cambio-engine.test.js
```

Os testes cobrem:
- Conversão monetária bidirecional.
- Cálculos de VET, custos de IOF e Spreads bancários.
- Validação e sanitização de dados do `localStorage` e payloads de API externa.
- Verificação de disparos de alertas.

---

## 🚀 Como Executar

Por ser uma aplicação estática client-side com Service Worker, sirva os arquivos a partir de qualquer servidor web local:

```bash
# Com Python 3
cd src
python3 -m http.server 8080

# Ou com npx serve
npx serve src
```

Acesse em seu navegador `http://localhost:8080`.
