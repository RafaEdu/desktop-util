# Deployment corporativo

Este diretório contém apenas **modelos e scripts públicos de deployment**. Os valores reais de infraestrutura não devem ser versionados.

## Objetivo

A configuração da funcionalidade de recuperação de sessão é inserida **no momento da compilação** e incorporada ao executável Rust. O MSI continua autocontido e não precisa de arquivo de configuração, variável de ambiente, acesso à Internet ou serviço externo na estação do usuário.

## Arquivos

- `config.example.env`: modelo público sem valores reais;
- `config.local.env`: configuração privada da máquina de build; é bloqueada pelo `.gitignore` e não deve ser commitada;
- `build-msi.ps1`: valida a configuração privada antes de gerar o MSI corporativo.

## Preparação da máquina de build

Na raiz do repositório:

```powershell
Copy-Item .\deployment\config.example.env .\deployment\config.local.env
```

Edite `deployment/config.local.env` e preencha os valores reais do ambiente corporativo:

```text
REMOTE_SESSION_ENABLED=true
REMOTE_SESSION_SERVER=<servidor-remoto>
REMOTE_SESSION_EXPECTED_DOMAIN=<dominio-windows>
REMOTE_SESSION_EXECUTABLE=<executavel.exe>
```

Nunca substitua os placeholders de `config.example.env` pelos valores reais.

Confirme que o arquivo local está ignorado:

```powershell
git check-ignore -v .\deployment\config.local.env
```

O comando deve apontar uma regra do `.gitignore`.

## Geração do MSI

Use o script de deployment:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deployment\build-msi.ps1
```

Se `npm ci` já tiver sido executado e você quiser apenas repetir o build:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deployment\build-msi.ps1 -SkipNpmCi
```

O script:

1. exige `config.local.env`;
2. exige que a funcionalidade remota esteja habilitada;
3. valida servidor, domínio e nome do executável sem exibir esses valores;
4. confirma que `config.local.env` está protegido pelo Git;
5. executa `npm ci`, `npm run build` e `npm run tauri build`;
6. localiza o MSI final;
7. imprime o SHA-256 do MSI.

## Funcionamento offline

Os valores de deployment são lidos apenas durante o build pelo `src-tauri/build.rs`. O arquivo local não é copiado para a estação e não é necessário em runtime.

Os scripts PowerShell continuam incorporados ao binário por `include_bytes!`. Durante a execução, o Rust materializa somente o script autorizado em diretório temporário exclusivo e passa a configuração como argumentos individuais do processo.

## Distribuição por GPO

O fluxo permanece o mesmo:

1. gerar o MSI na máquina de build;
2. instalar em uma estação piloto;
3. testar as duas ações de recuperação;
4. validar que somente os processos/sessão do usuário atual foram afetados;
5. copiar o MSI para o compartilhamento corporativo usado pela GPO;
6. comparar o SHA-256 do arquivo de origem com o arquivo copiado;
7. atribuir o MSI pela política existente.

Não altere o `UpgradeCode` do `tauri.conf.json` durante este hardening.

## Regras de segurança

Nunca versione:

- `config.local.env`;
- senhas, tokens ou connection strings;
- `.pfx`, `.p12`, `.key`, `.pem` ou outros arquivos de chave/certificado de cliente;
- bancos SQLite de runtime;
- dumps ou backups de banco;
- arquivos contendo dados exportados de clientes.

O repositório público deve conter apenas configuração de exemplo e documentação genérica.
