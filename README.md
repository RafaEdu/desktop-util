<p align="center">
  <img src="app-icon.png" alt="Adcontec Útil" width="120">
</p>

<h1 align="center">Adcontec Útil</h1>

<p align="center">
  <strong>As ferramentas do escritório em um só lugar.</strong>
</p>

<p align="center">
  Um aplicativo desktop desenvolvido para simplificar tarefas diárias, reduzir operações repetitivas e facilitar o acesso às principais utilidades utilizadas pela AD Contec.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/versão-5.1.1-6d28d9" alt="Versão">
  <img src="https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri&logoColor=white" alt="Tauri">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/Rust-desktop-000000?logo=rust&logoColor=white" alt="Rust">
  <img src="https://img.shields.io/badge/plataforma-Windows-0078D4?logo=windows&logoColor=white" alt="Windows">
</p>

---

## Sobre o projeto

O **Adcontec Útil** é uma central de produtividade para desktop que reúne, em uma única aplicação, ferramentas utilizadas diariamente em rotinas administrativas, fiscais, contábeis e de atendimento.

O objetivo é simples:

> Menos janelas abertas, menos tarefas repetitivas e mais agilidade no trabalho.

O aplicativo funciona diretamente no computador, permanece disponível na bandeja do Windows e pode ser utilizado em dois formatos:

* **Modo compacto:** painel flutuante de acesso rápido;
* **Modo janela:** interface ampliada, redimensionável e com menu lateral.

Grande parte dos dados é armazenada localmente, sem depender de uma plataforma externa para as funções principais.

---

## Ferramentas disponíveis

### Dashboard personalizável

A tela inicial centraliza todas as ferramentas do aplicativo.

O Dashboard permite:

* favoritar as ferramentas mais utilizadas;
* reorganizar os cards;
* arquivar ferramentas que não fazem parte da rotina do usuário;
* restaurar ferramentas arquivadas;
* alternar entre tema claro e escuro;
* acessar rapidamente qualquer funcionalidade.

Cada colaborador pode organizar o painel conforme a própria rotina de trabalho.

---

### Tarefas

Gerenciador local para atividades rápidas do dia a dia.

Permite:

* adicionar novas tarefas;
* visualizar tarefas em andamento;
* marcar tarefas como concluídas;
* consultar o histórico de conclusão;
* restaurar tarefas concluídas;
* reorganizar a ordem das atividades;
* excluir tarefas;
* visualizar a data de criação e conclusão.

As tarefas são armazenadas localmente em um banco de dados SQLite.

Ideal para pequenas pendências que não justificam a abertura de um sistema completo de gestão.

---

### Textos Prontos

Biblioteca de mensagens e respostas utilizadas com frequência.

Permite:

* cadastrar novos textos;
* definir um título para cada mensagem;
* editar textos existentes;
* excluir mensagens;
* copiar o conteúdo com um clique.

Exemplos de uso:

* saudações;
* encerramentos de atendimento;
* solicitações de documentos;
* orientações recorrentes;
* mensagens para clientes;
* respostas padronizadas;
* avisos internos.

Os textos ficam salvos localmente no computador.

---

### Histórico da área de transferência

Um histórico de textos copiados, semelhante ao recurso `Win + V` do Windows.

A ferramenta:

* monitora textos copiados;
* mantém os últimos 50 registros;
* exibe os itens mais recentes primeiro;
* permite copiar novamente qualquer registro;
* permite limpar todo o histórico.

Útil para recuperar rapidamente informações copiadas anteriormente, como códigos, descrições, números de documentos e mensagens.

> **Atenção:** senhas, tokens, dados de clientes e outras informações confidenciais também podem ser registradas caso sejam copiadas. Limpe o histórico sempre que necessário.

---

### Relógio, cronômetro e alertas

Ferramenta de controle de tempo com dois modos de funcionamento.

#### Cronômetro

Permite:

* iniciar;
* pausar;
* continuar;
* zerar;
* registrar voltas;
* visualizar o tempo total e o tempo de cada volta.

#### Contagem regressiva

Permite criar alertas:

* por duração em minutos e segundos;
* para um horário específico;
* com nome personalizado;
* com notificação silenciosa;
* trazendo a janela do aplicativo para frente ao finalizar.

Caso o horário escolhido já tenha passado no dia atual, o alerta será programado para o dia seguinte.

Pode ser utilizado para controlar reuniões, pausas, retornos, prazos rápidos e atividades com tempo determinado.

---

### Links Rápidos

Central de atalhos para sites e sistemas utilizados no escritório.

Permite:

* cadastrar links;
* informar um nome para cada acesso;
* editar links existentes;
* excluir links;
* abrir no navegador padrão;
* abrir em janela privada ou anônima.

Exemplos:

* e-CAC;
* eSocial;
* Gov.br;
* portais municipais;
* sistemas estaduais;
* plataformas internas;
* sites de clientes;
* serviços bancários;
* ferramentas de consulta.

No modo privado, o aplicativo procura um navegador compatível instalado no computador.

---

### Certificados Digitais

Gerenciador dos certificados disponíveis no repositório pessoal do Windows.

A ferramenta permite:

* listar os certificados instalados;
* consultar o titular;
* consultar o emissor;
* visualizar a validade;
* visualizar o thumbprint;
* pesquisar por titular ou emissor;
* identificar certificados válidos;
* destacar certificados próximos do vencimento;
* identificar certificados vencidos;
* excluir um certificado individualmente;
* excluir certificados vencidos em lote.

Classificação visual:

| Situação        | Critério                          |
| --------------- | --------------------------------- |
| Válido          | Mais de 30 dias para o vencimento |
| Expira em breve | Até 30 dias para o vencimento     |
| Expirado        | Data de validade encerrada        |

> **Atenção:** a exclusão remove o certificado do repositório pessoal do usuário no Windows. Confirme se o certificado não é mais necessário antes de removê-lo.

---

### Status de Serviços

Verifica rapidamente a disponibilidade de serviços governamentais utilizados pelo escritório.

Serviços monitorados:

* eSocial;
* Gov.br;
* Empregador Web;
* Portal Nacional da NF-e;
* e-CAC;
* Emissor Nacional da NFS-e.

Resultados possíveis:

| Status      | Significado                                               |
| ----------- | --------------------------------------------------------- |
| Online      | O serviço respondeu normalmente                           |
| Instável    | O endereço respondeu com erro ou comportamento inesperado |
| Offline     | O serviço não respondeu dentro do limite definido         |
| Verificando | Consulta em andamento                                     |

A ferramenta utiliza um limite de espera para evitar que serviços lentos bloqueiem o aplicativo.

> O resultado representa uma verificação de acesso ao endereço. Ele não substitui comunicados oficiais de indisponibilidade ou manutenção.

---

### Captura de Tela

Atalho direto para a ferramenta de recorte do Windows.

Ao clicar, o aplicativo inicia o mesmo recurso do comando:

```text
Win + Shift + S
```

Permite capturar rapidamente:

* uma área específica;
* uma janela;
* a tela inteira;
* mensagens de erro;
* telas de sistemas;
* comprovantes;
* informações para suporte.

Disponível no Windows.

---

### Recuperar Domínio

Ferramenta interna para recuperar o acesso ao Domínio Sistemas no SRV-IBM sem depender da intervenção manual do administrador.

Oferece duas ações:

* **Fechar todos os módulos do Domínio:** encerra somente os processos autorizados do Domínio na sessão RDS atual;
* **Encerrar minha sessão:** faz logoff completo somente da sessão RDS atual do colaborador.

A implementação utiliza dois scripts PowerShell incorporados ao instalador. Os comandos são executados com a conta comum do colaborador e atuam remotamente no `SRV-IBM`. Não há novo RemoteApp, arquivo `.rdp`, instalação no servidor ou senha administrativa.

> **Atenção:** as duas ações podem causar perda de informações não salvas. O aplicativo exige confirmação antes de executar. O fechamento do Domínio pode levar aproximadamente um minuto.

O procedimento completo está em [`docs/IMPLANTACAO-RECUPERAR-DOMINIO.md`](docs/IMPLANTACAO-RECUPERAR-DOMINIO.md).

---

### Ferramentas de PDF

Conjunto de utilidades para manipulação de documentos PDF.

#### Unir PDFs

Permite:

* selecionar dois ou mais arquivos;
* adicionar arquivos por seleção ou arrastar e soltar;
* reorganizar a ordem dos documentos;
* remover itens da lista;
* definir o nome do arquivo final;
* gerar um único PDF.

A ordem apresentada na lista será utilizada na montagem do documento.

#### Dividir PDF

Permite separar um documento utilizando diferentes estratégias:

* uma página por arquivo;
* páginas ímpares e pares;
* páginas pares e ímpares;
* divisão após páginas específicas;
* divisão a cada quantidade definida de páginas.

Também é possível definir:

* diretório de destino;
* prefixo dos arquivos gerados.

Exemplos:

```text
Dividir após as páginas 3, 7 e 12
```

```text
Gerar um novo arquivo a cada 5 páginas
```

#### Comprimir PDF

Permite reduzir e reorganizar a estrutura interna de um PDF.

Níveis disponíveis:

| Nível       | Finalidade                             |
| ----------- | -------------------------------------- |
| Baixa       | Compressão leve                        |
| Recomendada | Equilíbrio entre tamanho e integridade |
| Extrema     | Maior otimização estrutural            |

Após o processamento, a ferramenta informa:

* tamanho original;
* tamanho final;
* percentual de redução.

> A compressão atual é principalmente estrutural. PDFs formados por imagens digitalizadas podem apresentar pouca redução, pois a ferramenta não reduz diretamente a resolução das imagens.

---

### Assinar PDF

Ferramenta para assinatura digital de documentos PDF utilizando certificados instalados no Windows.

Fluxo de utilização:

1. Selecione ou arraste um arquivo PDF;
2. Visualize o documento;
3. Escolha a página da assinatura;
4. Posicione e dimensione a representação visual;
5. Selecione o certificado;
6. Defina o local de salvamento;
7. Gere o documento assinado.

A representação visual pode incluir:

* titular do certificado;
* CNPJ identificado;
* data e hora da assinatura.

Além da marca visual, o aplicativo realiza uma assinatura digital criptográfica no padrão **PAdES**, utilizando:

* certificado do repositório pessoal do Windows;
* chave privada vinculada ao certificado;
* algoritmo de resumo SHA-256;
* assinatura RSA PKCS#1 v1.5.

O arquivo original não é sobrescrito. Um novo documento é gerado com o sufixo:

```text
_assinado.pdf
```

#### Limitação atual

A assinatura PAdES suporta certificados com chave **RSA**.

Certificados baseados em **ECDSA** ainda não são aceitos nesse fluxo.

> O certificado precisa estar instalado no Windows e possuir uma chave privada acessível pelo usuário.

---

### Criar ZIP

Ferramenta para gerar arquivos compactados.

Permite:

* selecionar vários arquivos;
* adicionar arquivos por arrastar e soltar;
* remover itens antes da compactação;
* escolher o nome e local do arquivo final;
* gerar um arquivo no formato `.zip`.

A compactação utiliza o método Deflate.

Ideal para reunir:

* documentos de clientes;
* arquivos fiscais;
* XMLs;
* relatórios;
* planilhas;
* PDFs;
* arquivos para envio por e-mail.

---

## Integração com o Windows

O aplicativo possui integração com recursos nativos do sistema operacional.

Entre os principais comportamentos:

* inicialização automática com o sistema;
* execução na bandeja do Windows;
* exibição e ocultação pelo ícone da bandeja;
* opção de restaurar a janela;
* modo compacto posicionado próximo à bandeja;
* fechamento da janela sem encerrar o aplicativo;
* captura de tela nativa;
* acesso ao repositório de certificados;
* notificações do sistema;
* leitura e escrita na área de transferência.

Para encerrar completamente o aplicativo, utilize a opção **Sair** no menu da bandeja.

---

## Armazenamento de dados

Os dados principais são armazenados localmente.

| Informação                         | Armazenamento |
| ---------------------------------- | ------------- |
| Tarefas                            | SQLite        |
| Links rápidos                      | SQLite        |
| Textos prontos                     | Local Storage |
| Histórico da área de transferência | Local Storage |
| Favoritos do Dashboard             | Local Storage |
| Ordem dos cards                    | Local Storage |
| Ferramentas arquivadas             | Local Storage |
| Tema e modo de visualização        | Local Storage |

O banco SQLite utilizado pelo aplicativo é:

```text
todo.db
```

Atualmente, não existe sincronização automática em nuvem entre computadores.

---

## Tecnologias

### Interface

* React 19;
* TypeScript;
* Vite;
* Tailwind CSS;
* Lucide Icons;
* Day.js;
* React PDF;
* PDF.js;
* PDF-Lib.

### Aplicação desktop

* Tauri 2;
* Rust;
* SQLite;
* APIs nativas do Windows;
* Windows Certificate Store;
* CNG e CryptoAPI;
* PAdES;
* SHA-256;
* ZIP Deflate.

---

## Arquitetura

O projeto é dividido em duas camadas principais:

```text
desktop-util/
├── deployment/              # Script de compilação do instalador
├── docs/                    # Implantação e testes operacionais
├── remote-session-scripts/  # Ações remotas incorporadas ao instalador
├── public/                  # Arquivos públicos
├── src/                     # Interface React
│   ├── components/          # Ferramentas e componentes
│   ├── lib/                 # Banco, tema e utilitários
│   ├── App.tsx              # Navegação e modos de janela
│   └── main.tsx             # Inicialização do frontend
├── src-tauri/               # Aplicação nativa
│   ├── src/
│   │   ├── lib.rs           # Comandos, bandeja e integrações
│   │   ├── pdf_utils.rs     # Manipulação e assinatura de PDFs
│   │   ├── remote_session.rs # Execução segura dos scripts fixos
│   │   └── zip_utils.rs     # Criação de arquivos ZIP
│   ├── capabilities/        # Permissões do Tauri
│   ├── icons/               # Ícones dos instaladores
│   ├── Cargo.toml           # Dependências Rust
│   └── tauri.conf.json      # Configuração do aplicativo
├── package.json
├── vite.config.ts
└── README.md
```

A interface React chama comandos Rust por meio da API `invoke` do Tauri.

As tarefas que exigem acesso ao sistema operacional são executadas pela camada Rust.

---

## Requisitos para desenvolvimento

### Windows

Para compilar o projeto no Windows, instale:

* Node.js LTS;
* npm;
* Rust;
* Microsoft C++ Build Tools;
* Microsoft Edge WebView2;
* Git.

No instalador do Visual Studio Build Tools, selecione:

```text
Desenvolvimento para desktop com C++
```

Em versões recentes do Windows 10 e Windows 11, o WebView2 geralmente já está instalado.

---

## Instalação do projeto

Clone o repositório:

```bash
git clone https://github.com/RafaEdu/desktop-util.git
```

Entre na pasta:

```bash
cd desktop-util
```

Instale as dependências bloqueadas pelo arquivo de lock:

```bash
npm ci
```

---

## Executar em desenvolvimento

Para iniciar a aplicação completa:

```bash
npm run tauri dev
```

O comando inicia:

* o servidor Vite;
* a interface React;
* a compilação Rust;
* a janela desktop do Tauri.

Para executar apenas o frontend:

```bash
npm run dev
```

> Algumas ferramentas não funcionarão corretamente fora da janela Tauri, pois dependem de APIs nativas.

---

## Gerar uma versão de produção

Execute:

```bash
npm run tauri build
```

O processo gera:

* aplicação compilada;
* executável;
* pacotes de instalação compatíveis com a configuração;
* arquivos de distribuição na pasta de bundle do Tauri.

Antes de gerar uma nova versão, atualize a versão em:

```text
package.json
src-tauri/tauri.conf.json
src-tauri/Cargo.toml
```

---

## Scripts disponíveis

| Comando               | Função                                  |
| --------------------- | --------------------------------------- |
| `npm run dev`         | Inicia o frontend com Vite              |
| `npm run build`       | Compila TypeScript e frontend           |
| `npm run preview`     | Visualiza o build do frontend           |
| `npm run tauri dev`   | Executa o aplicativo em desenvolvimento |
| `npm run tauri build` | Gera a aplicação de produção            |

---

## Versionamento

O projeto utiliza o formato:

```text
MAJOR.MINOR.PATCH
```

Aplicado da seguinte forma:

| Posição | Alteração                                   |
| ------- | ------------------------------------------- |
| MAJOR   | Nova ferramenta ou funcionalidade relevante |
| MINOR   | Melhoria em ferramentas existentes          |
| PATCH   | Correção de erro ou ajuste pontual          |

Exemplo:

```text
5.2.1
```

Significa:

* quinta geração principal do aplicativo;
* duas melhorias funcionais;
* uma correção de erro.

---

## Segurança e privacidade

O aplicativo manipula informações potencialmente sensíveis.

Recomendações:

* não mantenha senhas no histórico da área de transferência;
* revise o histórico antes de compartilhar o computador;
* confirme o certificado antes de assinar um documento;
* não exclua certificados sem validar sua necessidade;
* utilize apenas instaladores distribuídos por fonte confiável;
* não execute versões modificadas sem revisão;
* mantenha cópias dos documentos originais;
* valide assinaturas digitais em ferramenta apropriada quando necessário.

A assinatura digital utiliza a chave privada por meio do provedor criptográfico do Windows. A chave privada não é exportada pelo aplicativo.

---

## Limitações conhecidas

* algumas funções são exclusivas do Windows;
* a assinatura PAdES suporta atualmente certificados RSA;
* certificados ECDSA não são suportados;
* a compressão de PDF não reduz diretamente a resolução das imagens;
* o status dos serviços indica acessibilidade, não disponibilidade oficial;
* o histórico registra somente conteúdo textual;
* não existe sincronização em nuvem;
* configurações locais não são compartilhadas entre computadores;
* fechar a janela não encerra o aplicativo.

---

## Diretrizes para contribuições

Antes de enviar alterações:

1. Crie uma branch específica;
2. Implemente apenas uma finalidade principal por alteração;
3. Teste o modo compacto;
4. Teste o modo janela;
5. Verifique o tema claro;
6. Verifique o tema escuro;
7. Teste a integração com a bandeja;
8. Teste a persistência dos dados;
9. Execute o build de produção;
10. Atualize a versão quando aplicável.

Sugestão de nomenclatura:

```text
feature/nome-da-ferramenta
fix/descricao-do-erro
improvement/nome-da-melhoria
```

Exemplo de commit:

```text
feat: adiciona consulta de certificados digitais
```

```text
fix: corrige posicionamento da janela compacta
```

```text
improvement: melhora divisão de arquivos PDF
```

---

## Identificação do aplicativo

| Campo                | Informação                   |
| -------------------- | ---------------------------- |
| Nome                 | Adcontec Útil                |
| Versão               | 5.0.0                        |
| Identificador        | `com.adcontec-util.app`      |
| Publicador           | AD CONTEC Contabilidade LTDA |
| Repositório          | RafaEdu/desktop-util         |
| Plataforma principal | Windows                      |

---

## Uso e distribuição

Este projeto foi desenvolvido para apoiar as rotinas internas da **AD CONTEC Contabilidade LTDA**.

Antes de distribuir publicamente, recomenda-se definir formalmente:

* licença de uso;
* política de privacidade;
* processo de atualização;
* assinatura do instalador;
* canal oficial de distribuição;
* responsável pela manutenção;
* política de suporte;
* procedimento de reporte de vulnerabilidades.

---

<p align="center">
  <strong>Adcontec Útil</strong><br>
  Tecnologia aplicada às rotinas que realmente importam.
</p>
