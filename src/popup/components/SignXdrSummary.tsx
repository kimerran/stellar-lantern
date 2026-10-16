import type { ValidSignXdr } from '@core/dapp/sign-xdr';
import { truncateAddress } from '@shared/format';

// What a dApp-built transaction asks of the user (#262; web connect #252): which operations
// their signature authorizes, who else signs, and that Lantern hands the
// signed envelope back rather than submitting it. The scan's explanation —
// above the buttons, as for any review — says what the operations do.
export function SignXdrSummary({ value }: { value: ValidSignXdr }) {
  const { signing, operationCount, existingSignatures } = value;
  const yours = signing.userOps.length;
  return (
    <div className="space-y-2 rounded-xl bg-surface-container-high p-3 text-label-md text-on-surface">
      <p>
        {signing.userIsTxSource
          ? `Your account is the transaction source (it pays the fee) and acts in ${yours} of ${operationCount} operation${operationCount === 1 ? '' : 's'}.`
          : `Your signature authorizes ${yours} of ${operationCount} operation${operationCount === 1 ? '' : 's'}.`}
        {signing.otherSigners.length > 0 && (
          <>
            {' '}
            Also signed by{' '}
            <span className="font-mono">
              {signing.otherSigners.map((a) => truncateAddress(a, 4, 4)).join(', ')}
            </span>
            {existingSignatures > 0
              ? ` (${existingSignatures} signature${existingSignatures === 1 ? '' : 's'} already on it).`
              : '.'}
          </>
        )}
      </p>
      <ol className="space-y-0.5 text-label-sm text-on-surface-variant">
        {signing.ops.map((op) => (
          <li key={op.opIndex} className="flex justify-between gap-2">
            <span className="truncate">
              {op.opIndex + 1}. {op.type}
            </span>
            <span className={`shrink-0 font-mono ${op.byUser ? 'text-primary' : ''}`}>
              {op.byUser ? 'you' : truncateAddress(op.source, 4, 4)}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-label-sm text-on-surface-variant">
        Lantern adds your signature and returns it to the app. It doesn’t submit the transaction.
      </p>
    </div>
  );
}
