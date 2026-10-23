import { enterLiveCheck } from '../../scripts/lib/liveContinuation.ts';
console.log(JSON.stringify(enterLiveCheck(42, { watchId: process.argv[2], generation: Number(process.argv[3]) }, process.argv[4])));
