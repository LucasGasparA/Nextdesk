# NextDesk — Extensão de navegador para tickets do Freshdesk

**Data:** 2026-09-29
**Status:** aguardando revisão

## Objetivo

Permitir que o usuário trate os tickets do grupo **CSM - Engajamento** sem abrir o Freshdesk (`ajuda.nextfit.com.br`): ver a fila, ler a conversa, responder o cliente, deixar nota privada e delegar a um agente do time — tudo pelo popup de uma extensão.

**Sucesso:** o fluxo diário de triagem (ver ticket novo sem responsável → responder/delegar) e de acompanhamento da própria caixa acontece inteiro no popup.

## Escopo

**Dentro**
- Fila com tickets **abertos** (status `Aberto`) do grupo CSM - Engajamento, em dois blocos:
  - **Sem responsável** — sem agente atribuído
  - **Meus tickets** — atribuídos ao usuário
- Leitura da conversa do ticket
- Resposta pública ao cliente e nota privada, com respostas prontas (canned responses)
- Edição de **Status**, **Agente** (só agentes do grupo) e **Tipo**

**Fora (v1)**
- Prioridade, Tags, troca de Grupo (o grupo é fixo: CSM - Engajamento)
- Anexos
- Notificações e selo de contagem no ícone
- Atribuição automática ao responder
- Uso por várias pessoas com chave compartilhada / servidor intermediário
- Aba de e-mails recebidos para converter em ticket (planejada para a V2, ver abaixo)

## Plataforma

- Extensão **Manifest V3** para Chrome e Edge, carregada como pasta descompactada (modo desenvolvedor)
- JavaScript puro com ES modules, sem build e sem dependências de runtime
- Testes com o runner nativo do Node (`node --test`)

## Arquitetura

```
manifest.json
popup.html / popup.css
src/
  popup.js     — telas e eventos (única parte que mexe no DOM)
  api.js       — cliente HTTP do Freshdesk (auth, erros, paginação)
  queue.js     — monta as consultas da fila e filtra/ordena os resultados
  fields.js    — opções de Status/Tipo, diferença de campos, validação do Salvar
  format.js    — texto → HTML escapado, "há X horas", domínio, placeholders
  storage.js   — leitura/gravação da configuração e do cache
  actions.js   — fluxos (configurar, carregar fila/ticket, salvar) sobre o cliente
tests/
  um arquivo *.test.js por módulo de src/ (exceto popup.js)
```

Cada módulo de `src/` exceto `popup.js` é puro ou recebe `fetch`/storage por parâmetro, para ser testável no Node sem navegador.

## Telas

1. **Configuração** (primeira execução ou após erro 401)
   - Campos: domínio (padrão `ajuda.nextfit.com.br`) e chave de API
   - Ao salvar: valida com `GET /api/v2/agents/me`, obtém o ID do usuário e localiza o grupo "CSM - Engajamento" em `GET /api/v2/groups`
   - Se o domínio próprio não responder à API, exibe mensagem sugerindo o domínio `*.freshdesk.com` da conta
2. **Lista**
   - Blocos "Sem responsável" e "Meus tickets", com contagem
   - Cada item: assunto, cliente, número e tempo desde a criação (o status não aparece: todos são Abertos)
   - A busca não traz o nome do cliente; ele vem de `GET /api/v2/contacts/{id}` e fica guardado localmente (sem expiração). Se a consulta falhar, mostra "Cliente #id"
   - Botão atualizar; lista recarrega ao abrir o popup
3. **Ticket**
   - Cabeçalho: assunto, cliente, link "abrir no Freshdesk"
   - Conversa em ordem cronológica (descrição inicial + conversas), notas privadas destacadas
   - Seletor **Responder ao cliente / Nota privada**, seletor de resposta pronta (preenche o texto, editável), caixa de texto
   - Campos Status, Agente, Tipo
   - Botão **Salvar**: envia a resposta/nota (se houver texto) e depois as alterações de campos (se houver)
   - Após salvar, volta à lista atualizada

## Chamadas à API (v2)

Autenticação: `Authorization: Basic base64("<chave>:X")`.

| Uso | Chamada |
|---|---|
| Validar chave / meu ID | `GET /api/v2/agents/me` |
| ID do grupo | `GET /api/v2/groups` (busca pelo nome) |
| Agentes do grupo | `GET /api/v2/groups/{id}` (`agent_ids`) + `GET /api/v2/agents` paginado para os nomes |
| Opções de Status e Tipo | `GET /api/v2/ticket_fields` (campos `status` e `ticket_type`) |
| Fila — sem responsável | `GET /api/v2/search/tickets?query="group_id:{g} AND agent_id:null AND status:2"` |
| Fila — meus | `GET /api/v2/search/tickets?query="group_id:{g} AND agent_id:{eu} AND status:2"` |
| Ticket | `GET /api/v2/tickets/{id}?include=requester` |
| Conversa | `GET /api/v2/tickets/{id}/conversations` |
| Nome do cliente | `GET /api/v2/contacts/{id}` |
| Respostas prontas | `GET /api/v2/canned_response_folders` + `.../{id}/responses`; conteúdo em `GET /api/v2/canned_responses/{id}` ao escolher |
| Responder | `POST /api/v2/tickets/{id}/reply` `{ body }` |
| Nota privada | `POST /api/v2/tickets/{id}/notes` `{ body, private: true }` |
| Atualizar campos | `PUT /api/v2/tickets/{id}` `{ status, responder_id, type }` (só os alterados) |

Observações:
- A API não expõe filtros salvos pelo ID; a fila do filtro `69000401702` é recriada pelas duas buscas acima. Status `2` = Aberto.
- A busca retorna 30 por página (máx. 10 páginas); `api.js` pagina até acabar.
- Agentes, opções de campos, grupo e respostas prontas ficam em cache em `chrome.storage.local` por 24 h, com botão para recarregar na tela de configuração.

## Conteúdo e segurança

- A chave de API fica somente em `chrome.storage.local`; nunca vai para código, log ou outro host.
- `host_permissions` limitado ao domínio configurado (`https://ajuda.nextfit.com.br/*` e `https://*.freshdesk.com/*`).
- A conversa é exibida a partir de `body_text` como texto (sem injetar HTML do cliente no popup).
- Respostas prontas: os campos `{{ticket.id}}`, `{{ticket.subject}}`, `{{ticket.requester.name}}` e `{{ticket.requester.firstname}}` são preenchidos no popup; se sobrar algum `{{...}}`, o popup avisa para revisar antes de enviar.
- O texto digitado é escapado e convertido em HTML simples (quebras de linha → `<br>`) antes do envio.

## Erros

| Situação | Comportamento |
|---|---|
| 401 | Mensagem "chave inválida" e volta para Configuração |
| 429 | Mostra aviso com o tempo do cabeçalho `Retry-After`; não reenvia sozinho ações de escrita |
| Tipo vazio ao salvar alteração de campos | Salvar bloqueado e campo destacado |
| Falha de rede / 5xx | Mensagem de erro; texto digitado e campos permanecem na tela |
| Resposta enviada mas PUT falhou | Informa que a resposta foi enviada e que os campos não foram salvos, mantendo os campos para nova tentativa |

## Testes

- **Automatizados (`node --test`):** montagem das consultas, junção/ordenação dos dois blocos, paginação, escape de texto, validação do formulário, tratamento de 401/429 no `api.js` com `fetch` simulado.
- **Manual com a chave real:** configuração, carregamento da fila, abertura de ticket e respostas prontas. Envio de resposta, nota e alteração de campos só em ticket de teste indicado pelo usuário.

## V2 (pendente — não faz parte desta implementação)

**Aba "E-mails recebidos":** lista e-mails que chegam ao e-mail do usuário, tanto os encaminhados pelo financeiro quanto os que clientes mandam direto. Ao clicar num e-mail, o usuário o **converte em ticket** no Freshdesk pela API (`POST /api/v2/tickets`, com remetente, assunto e corpo do e-mail, já no grupo CSM - Engajamento).

Ainda a decidir antes de desenhar:
- De onde vêm os e-mails: API do provedor (Gmail / Microsoft 365) com login OAuth na extensão, ou leitura da página do webmail aberto
- Quais e-mails aparecem: todos, só de certos remetentes/rótulos (ex.: financeiro), ou só os não convertidos
- O que acontece com o e-mail depois de convertido: marcar como lido, arquivar, aplicar rótulo
- Anexos do e-mail vão junto para o ticket ou não
