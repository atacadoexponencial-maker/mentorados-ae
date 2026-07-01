# 04: Backend — Rota Pública de Leitura do Briefing por Token

**Tipo:** Implementação
**Página:** Módulo A — Tela Pública de Briefing do Mentorado

## Descrição
Criar a rota pública (sem login) que recebe um token, valida se ele existe e está ativo, e retorna o nome da marca/mentorado associado e as respostas já existentes do briefing. Quando o token for inválido, inexistente ou revogado, responder com erro sem expor dados do sistema.
