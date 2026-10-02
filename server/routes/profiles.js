import { Router } from 'express';
import { all, get, run } from '../db.js';
import { can, outranks, requireAuth, requirePermission } from '../auth.js';
import { ALL_PERMISSIONS, PERMISSION_GROUPS, cleanPermissions } from '../permissions.js';

/**
 * Perfis de acesso: nome, nivel na hierarquia e direitos.
 *
 * Regras de quem gerencia (direito perfis.gerenciar):
 *  - so mexe em perfis ABAIXO do seu nivel, e so cria perfis abaixo dele;
 *  - so concede direitos que ele mesmo tem (ninguem cria um perfil "maior");
 *  - o perfil Administrador (nivel 0) e fixo: tem tudo, nao muda, nao sai.
 * O Administrador esta acima de todos e pode tudo, respeitando so a ultima regra.
 */
export const profilesRouter = Router();
profilesRouter.use(requireAuth);

const manage = requirePermission('perfis.gerenciar');

const list = (where = '', ...params) => all(`
  SELECT p.id, p.key, p.name, p.level, p.permissions,
         (SELECT COUNT(*) FROM users u WHERE u.profile_id = p.id) AS members,
         (SELECT COUNT(*) FROM invites i WHERE i.profile_id = p.id AND i.accepted_at IS NULL) AS pending_invites
    FROM profiles p ${where}
   ORDER BY p.level, lower(p.name)`, ...params);

/** O Administrador sempre aparece com todos os direitos (inclusive os futuros). */
const shape = (p, user) => ({
  ...p,
  permissions: p.key === 'admin' ? ALL_PERMISSIONS : p.permissions,
  is_system: Boolean(p.key),
  editable: p.key !== 'admin' && can(user, 'perfis.gerenciar') && outranks(user, p.level),
});

/** Nome, nivel e direitos vindos do formulario, ja validados contra quem pede. */
function readProfile(body, user) {
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 40) : '';
  const level = Number(body?.level);
  const permissions = cleanPermissions(body?.permissions);
  if (!name) return { error: 'Informe o nome do perfil.' };
  if (!Number.isInteger(level) || level < 1 || level > 99) {
    return { error: 'O nível precisa ser um número de 1 a 99 (1 é o mais alto depois do Administrador).' };
  }
  if (!outranks(user, level)) {
    return { error: `Você está no nível ${user.level}: só pode usar níveis maiores que o seu.` };
  }
  const beyond = permissions.filter((k) => !can(user, k));
  if (beyond.length) return { error: 'Você não pode conceder direitos que o seu próprio perfil não tem.' };
  return { name, level, permissions };
}

profilesRouter.get('/', async (req, res) => {
  res.json({
    groups: PERMISSION_GROUPS,
    profiles: (await list()).map((p) => shape(p, req.user)),
  });
});

profilesRouter.post('/', manage, async (req, res) => {
  const data = readProfile(req.body, req.user);
  if (data.error) return res.status(400).json({ error: data.error });
  if (await get('SELECT id FROM profiles WHERE name = ?', data.name)) {
    return res.status(409).json({ error: 'Já existe um perfil com esse nome.' });
  }
  const info = await run(
    'INSERT INTO profiles (name, level, permissions) VALUES (?, ?, ?) RETURNING id',
    data.name, data.level, data.permissions,
  );
  res.status(201).json(shape((await list('WHERE p.id = ?', info.lastInsertRowid))[0], req.user));
});

profilesRouter.patch('/:id', manage, async (req, res) => {
  const id = Number(req.params.id);
  const current = await get('SELECT * FROM profiles WHERE id = ?', id);
  if (!current) return res.status(404).json({ error: 'Perfil não encontrado.' });
  if (current.key === 'admin') return res.status(400).json({ error: 'O perfil Administrador é fixo: tem todos os direitos.' });
  if (!outranks(req.user, current.level)) {
    return res.status(403).json({ error: 'Esse perfil está no seu nível ou acima dele na hierarquia.' });
  }
  const data = readProfile(req.body, req.user);
  if (data.error) return res.status(400).json({ error: data.error });
  if (await get('SELECT id FROM profiles WHERE name = ? AND id <> ?', data.name, id)) {
    return res.status(409).json({ error: 'Já existe um perfil com esse nome.' });
  }
  // Direitos que quem edita nao tem nao podem ser concedidos, mas tambem nao
  // devem sumir so porque ele salvou: ficam como estavam.
  const kept = current.permissions.filter((k) => !can(req.user, k));
  await run(
    'UPDATE profiles SET name = ?, level = ?, permissions = ? WHERE id = ?',
    data.name, data.level, [...new Set([...data.permissions, ...kept])], id,
  );
  res.json(shape((await list('WHERE p.id = ?', id))[0], req.user));
});

profilesRouter.delete('/:id', manage, async (req, res) => {
  const id = Number(req.params.id);
  const [profile] = await list('WHERE p.id = ?', id);
  if (!profile) return res.status(404).json({ error: 'Perfil não encontrado.' });
  if (profile.key) return res.status(400).json({ error: `O perfil ${profile.name} é do sistema e não pode ser excluído.` });
  if (!outranks(req.user, profile.level)) {
    return res.status(403).json({ error: 'Esse perfil está no seu nível ou acima dele na hierarquia.' });
  }
  if (profile.members || profile.pending_invites) {
    return res.status(409).json({
      error: `Esse perfil ainda está em uso (${[
        profile.members && `${profile.members} ${Number(profile.members) === 1 ? 'pessoa' : 'pessoas'}`,
        profile.pending_invites && `${profile.pending_invites} ${Number(profile.pending_invites) === 1 ? 'convite' : 'convites'}`,
      ].filter(Boolean).join(' e ')}). Passe-os para outro perfil antes de excluir.`,
    });
  }
  await run('DELETE FROM profiles WHERE id = ?', id);
  res.json({ ok: true });
});
