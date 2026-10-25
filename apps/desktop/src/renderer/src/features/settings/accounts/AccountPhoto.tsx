import { useRef, useState } from "react";
import type { Account } from "@flint/core";
import { flint } from "../../../lib/api";
import { Avatar, Button, SettingsRow } from "../../../ui";
import { errorText } from "../useAccounts";
import { cropToSquare } from "./cropImage";

export type AccountPhotoProps = {
  account: Account;
  /** Called with the updated account after the photo is set or removed. */
  onChanged?: (account: Account) => void;
};

const SOURCE_TEXT: Record<NonNullable<Account["avatarSource"]>, string> = {
  custom: "A photo you chose. It stays on this computer.",
  google: "Your Google profile picture. Choose a photo to replace it.",
};

/** Profile picture for one account: choose a file (cropped to a centered square, 256px), or remove it to fall back. */
export function AccountPhoto({ account, onChanged }: AccountPhotoProps) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (image: string | null) => {
    setBusy(true);
    setError(null);
    try {
      onChanged?.(await flint.setAccountAvatar(account.id, image));
    } catch (err) {
      setError(errorText(err, "Couldn't save the photo. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const onPick = async (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    let image: string;
    try {
      image = await cropToSquare(file);
    } catch (err) {
      setError(errorText(err, "Flint couldn't read that image."));
      return;
    }
    await save(image);
  };

  const hint = account.avatarSource ? SOURCE_TEXT[account.avatarSource] : "Shown next to mail you send. Without a photo Flint shows your initials.";
  return (
    <SettingsRow title="Photo" description={error ? <span role="alert">{error}</span> : hint}>
      <Avatar address={account.email} name={account.name} accountId={account.id} size={32} />
      <Button variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
        {account.avatarSource === "custom" ? "Change photo" : "Choose photo"}
      </Button>
      {account.avatarSource === "custom" ? (
        <Button variant="ghost" disabled={busy} onClick={() => void save(null)}>Remove photo</Button>
      ) : null}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        aria-label={`Choose a photo for ${account.email}`}
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
    </SettingsRow>
  );
}
