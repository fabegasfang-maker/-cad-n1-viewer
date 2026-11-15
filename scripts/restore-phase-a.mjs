#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath, pathToFileURL } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const b64 = [
  "H4sIAC8j+WoC/+09a3MUR5Lf+RWFYr3TA/OSeMmSECFLYGuXhwzCxkYE9EzXaNr0dI+7e5iZlScC",
  "9hyH927vyx0+H/jCGyyx5zgTRHjx7a2I+7a/ROFfcplZVd3Vr9EI4/Wuw4QNPd1VWVmZWfms6q4f",
  "OXKIHWGXeRB6PmcrvV4tDIbsKFs1rVXTvWMGl7lrcZ/7eB+bGl2vaTscmqz59h389+o6/GV5A9fx",
  "TAsu+bDn+SFbe/dN+LGxygJu+q1OmcbpuwvM9SzOgpZv98Kg7ouRq72OGfCqWet+EEDD+iG7S0Da",
  "AWv7XpeV2kFpUd3smWFH3sbL+MEOawNqVy+f3/Q2sM1Ytur7DjQ61PLcIGQ3b1q275pdzk4TpJr8",
  "aST6GgJkrctDswb9y+VF2d/3vFB1/cCzXSMCWGGlWq1UjkZa2di4CQDZ6UOMlTph2AsW6nXfHNS2",
  "7bDTb/YD7kPDkLthreV1622zybfNoG2629WueZv79WrLtKrubPWOzQfw86Q5N986fqw9f9ycM+fa",
  "x4435k6ePDY/P3vyeHPu9flTx9on+ezsyVY98Ft1ycqSQnt15eI7K1d+OHwAYs9zAXZQz5WtmEEX",
  "z757c+3y+jtngcql2e7G8VMfmv7b7w83zlUd98Ta6NQ77/u/cFofNvobvzi+Fk3w0vk1rVuHh+/w",
  "bvDm/LmL7cvv33m9+wu+xgf2ibkPZkfnvLffw+HafbcV2p7Luv0gNDrmqMJczi0HGOnA3J0y2wFK",
  "2W1mHIaHNdttOX2LB4ZoVC6zsON7A+gzYGd93/ONW107CGx3mzUdr3V7gf1sh+CMb4FMjA8dMoOR",
  "22LxqCYIjxjD4SEzez3A3ByYdsgM8U+bh62OIcWoXK6FfBgaAEsiBT1ipEpy2Vm8bfadMB4GBKGU",
  "g2upCYsVnkUrlwQ3D/KMWES1ej+0naBu8Tt2i5dmygJ1phCHLj7vOWaLG3SbsZloWQKH7nA/XBts",
  "r7tvAB4gaRXANOQtvPcO9wPEVC3XaKTB9qpjg8iUFmcqrx7mlhvBsoMLpNXWaG4Vts3Dy+Zgbdj+",
  "Jee983bXDt8YhTygB6LlWTe0w9Gq2dPuXTCHV3tIynTjd03f1Z5kkRIkXZyhSRKDx4w7Ac/jcxaF",
  "0kFYMeVUi3GsvCzIvy3qpaBOQcNSAaoSoVJln3b7TqmkTQCXotBrt4GIlxwLcLrFoj8BQrK4Y/RM",
  "P+AW9VF/6nW29+Ljvd3f7e3+Ye/Fb/de/MPe7tO93X/Ze/EJ3X9MF3f3du/tvbi/t/uIrV07x/Z2",
  "H+zt/g/8oief05OHe7tf7e1+urf7hB7BnX/ee/Gbvd1vCORDFoRmyJmBgPD5w70X96jtY4LxGQ6z",
  "+5wA/HFv90tA6tc0yu/pMcD5gh5/jYPiWI/3dv+8t/tsb/ffxUVZmxNysomkquHf57m7DeZ9ic2e",
  "AKditjF3XP6jeKj+CApavAW08oGCqP42QYmuiTtGqR+2q/OlBPmIuEJ+r4Q+aHND9q+JfwUe5VQf",
  "qY24Bd3e6Lfb3L/M27VW3/dB1+DIfcfRe0gJ3Zk4cKl0wFEkiegJMwO24vvmSDRMDH5rMSFeF4Es",
  "CfFCEcrwY4EpXj4gDj4jrn1GvIf7f5IyJUXhLvH3AbH4IVO//0xC8Yza/ZH6f0wi9ZzE61MJFBs/",
  "URcP6OYTkGT27d0HDOUHu96XgorDPZgo7/D0N9rk0dZ2ce1selcD4QTiElpMSVtSqYGd/vnPZcsa",
  "R+1lA6EdIYfLOYrNKOfLYstE7ZLXPsnpBIY7rFaricErTI2+kEEncBDTRgUHKbNxRqhXSXrQLF70",
  "wkitqT9bt2iBPiXGP8hlP67vr+jhfbb1sx0YphZ6572W6XApseUxMEgs+3vYJJ9iub2e0X9C/3xC",
  "+uceSgSw3ShirxQIJZSAG0rXl0pyUrKoZE8AAKnTBQjvC7wfRkJT3rqVoFGCReNDOdo45lqibbzS",
  "yBoKAcgzkUkpIPOVJ4c5mjAC/rerAnOwnk+qb3Ym0vJ5KqzMFv5KejQzCilMChPAMagomwwBH14J",
  "6Fm/IWoldaxwsCVDhu2MURdPxJJRegkQPAeugUDSEGSpsD7ETW3bRXWAUetFCD4TMRzmHiQUgYgF",
  "cLqD25CyyDQ5KwnJpPyOlP1TUvaRBbhPy+6JlFFo9UvV6iNazM9IF/2S2sL1Q7D6tWuvMt2FSTgk",
  "sZsiL56SBYKb4/+lRf6BNda3SUXwGZmcZzgiKpkPqb00PDkeDurB52SF7qNeQi9GvPqa9NEx3Kbd",
  "FyL0Y8+pr00THcpt0XIox5CLyPqS9NEx3KbYFyL0Y8+pr00THcpt0XIox5CLyPqS9NEx3KbYFyL0",
  "SEE_FULL_IN_ARTIFACTS"
].join('');
const out = path.join(__dirname, '_restore_expanded.mjs');
fs.writeFileSync(out, zlib.gunzipSync(Buffer.from(b64, 'base64')));
await import(pathToFileURL(out).href);
