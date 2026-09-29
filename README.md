# NextDesk

Extensão do Chrome/Edge para tratar os tickets abertos do grupo **CSM - Engajamento** do Freshdesk sem abrir a ferramenta: ver a fila, responder, deixar nota privada e alterar Status, Agente e Tipo.

## Instalar

1. Abra `chrome://extensions` (ou `edge://extensions`).
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione esta pasta.
4. Fixe o ícone do NextDesk na barra.

## Configurar

1. No Freshdesk, clique na sua foto → **Configurações do perfil** → **Visualizar chave de API**.
2. Abra o popup do NextDesk, confira o domínio (`sistemanextfit.freshdesk.com`) e cole a chave.
3. Não use `ajuda.nextfit.com.br`: é só o portal de ajuda e não responde à API.

A chave fica só no armazenamento local do navegador.

## Atualizar depois de mudar o código

Em `chrome://extensions`, clique no ícone de recarregar do NextDesk.

## Testes

```bash
npm test
```

Requer Node 18 ou mais novo. Não há dependências.
