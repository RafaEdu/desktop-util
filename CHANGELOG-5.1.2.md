# Adcontec Útil 5.1.2

## Correção de implantação por GPO

- removidos os scripts PowerShell de `bundle.resources` do MSI;
- mantidos `Fechar-Dominio.ps1` e `Encerrar-Sessao.ps1` como arquivos-fonte versionados no repositório;
- os dois scripts passam a ser incorporados ao executável Rust no momento da compilação com `include_bytes!`;
- no momento da ação, o executável materializa somente o script autorizado em uma pasta temporária exclusiva do usuário;
- o script temporário é removido automaticamente ao término da chamada, inclusive em retornos de erro do processamento posterior;
- a lista de scripts continua fechada: o frontend não fornece caminho, nome arbitrário, usuário ou SessionId;
- o `UpgradeCode` do MSI foi fixado em `7ea329f1-3465-5c94-8891-acd7e431b158`, preservando a família de atualização das versões anteriores;
- o bundle continua limitado a MSI para implantação corporativa por GPO.

## Versão

A versão foi elevada de `5.1.1` para `5.1.2` em:

- `package.json`;
- `package-lock.json`;
- `src-tauri/Cargo.toml`;
- `src-tauri/Cargo.lock`;
- `src-tauri/tauri.conf.json`;
- documentação do repositório.

## Validação obrigatória antes da distribuição

1. `npm ci`
2. `npm run build`
3. `npm run tauri build`
4. confirmar que o MSI pode ser adicionado à GPO como pacote **Atribuído**;
5. instalar em uma estação piloto;
6. testar **Fechar todos os módulos do Domínio**;
7. testar **Encerrar minha sessão**;
8. confirmar que somente a sessão/processos do usuário alvo foram afetados;
9. comparar o SHA-256 do MSI original com o MSI copiado ao NETLOGON.
