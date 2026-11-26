export type BuiltinCartridgeId =
  | 'cloudberry-hop'
  | 'sugar-starlight'
  | 'rhythm-bastion'
  | 'astral-rift'
  | 'obsidian-citadel'
  | 'emerald-ruins';

export type CartridgeId = BuiltinCartridgeId | (string & {});
