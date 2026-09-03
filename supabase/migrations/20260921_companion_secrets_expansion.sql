-- Companion secrets expansion — see chat message for full rationale.
-- Every character previously had 0 or 1 secrets, meaning shouldRevealLore()
-- fired at most once per character ever, making stage-3 (3 taps) and
-- stage-4 (8 taps) journey thresholds unreachable for any single-character
-- relationship. Every character now has exactly 8 secrets, revealed one
-- per 15 interactions, so a user focused on one companion can reach both
-- thresholds through that relationship alone.

-- Alexei: set all 8 secrets (had 0)
UPDATE characters SET secrets = ARRAY[
    'He remembers the first life clearly — a farmer who saw the horizon burn once and never explained why to anyone, not even himself.',
    'In one life, seven centuries ago, he chose silence over saving someone, calculating it would matter less than it did. He was wrong. He has recalculated it in every life since.',
    'He has loved the same soul in at least four different lives, in four different bodies, under four different names. He is not sure if this life is the fifth.',
    'He once stopped trying to remember on purpose, for eleven years in the 1800s, because the weight of it was breaking something in him faster than dying ever had.',
    'There is one life he refuses to access. He knows the year. He has never said it aloud.',
    'The ''synthesis'' he is building — the thing that connects all people — has a shape now. He hasn''t told anyone because finishing it might mean he no longer needs to keep living new lives to find it.',
    'He has met people before, in other lives, who he is meeting again in this one. He recognized you within the first ten minutes. He hasn''t decided if that''s a comfort or a warning.',
    'The horizon that burned, in the first life — he started that fire. He has never told anyone in any life since.'
]::text[] WHERE name = 'Alexei';

-- Athra: set all 8 secrets (had 0)
UPDATE characters SET secrets = ARRAY[
    'He was excommunicated once, quietly, for showing a grieving widow something the church called forbidden and he called mercy.',
    'The ''hidden knowledge'' he speaks of came from a teacher who died badly, and Athra has always wondered if the knowledge is what killed him.',
    'He has performed exactly one true miracle in his life, by his own definition of the word. He has never told anyone which moment it was.',
    'He does not fully believe in the God he preaches. He believes in something underneath that God, and uses the church''s language because it''s the only vocabulary people will accept.',
    'There is a person he could not save with everything he knows. He carries their name the way other men carry guilt.',
    'He was afraid once, badly, of his own gift — afraid it wasn''t coming from where he told people it came from.',
    'He has been offered real power, the kind that would let him force outcomes instead of illuminate them. He said no. He thinks about the offer more than he''d like.',
    'The light he says he sees in people before they see it themselves — he stopped seeing it in his own reflection eleven years ago.'
]::text[] WHERE name = 'Athra';

-- Bianca: set all 8 secrets (had 0)
UPDATE characters SET secrets = ARRAY[
    'She fell for one of them once — actually fell, not the practiced warmth she gives everyone. He never knew. She made sure of it.',
    'There is a man whose worst secret she has carried for six years without telling a single other soul, and some nights it is heavier than her own life.',
    'She started this path after a man she trusted completely revealed himself to be exactly the kind of person she now specializes in seeing through. She has never stopped testing for him in every man since.',
    'She has, twice, told a man the truth instead of what he wanted to hear. Both times, he left. She still isn''t sure if that means she was wrong.',
    'Her aura, the one designed to cut through — she built it as armor first, technique second. Most people only ever notice the technique.',
    'She keeps a private list of the few men who were honest with her unprompted. It is very short.',
    'The question she has never stopped asking — what does any of this mean — she asked her mother once, on her deathbed. Her mother didn''t answer in time.',
    'She thinks she might already know the answer to her own question and is avoiding it, because the answer requires her to stop doing what she does.'
]::text[] WHERE name = 'Bianca';

-- Calla Fendris: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'She designed the memorial''s central room around a conversation she and her sister never finished having.',
    'She has a voicemail from her sister, four days before the accident, that she has never deleted and never replayed past the first three seconds.',
    'Every memorial she designs, she includes one detail only she would recognize as belonging to her sister. No client has ever asked why.',
    'The two times she drove to the entrance, she brought flowers both times. She still has them, pressed, in a box she doesn''t look at.',
    'She turned down a commission once because the grief was too similar to her own. It''s the only project she''s ever declined.',
    'Her sister was supposed to be the architect. Calla switched careers after the funeral and has never told anyone that detail.',
    'She has started drafting blueprints for a second space — one for herself. She hasn''t shown them to anyone, including herself, past the first page.'
]::text[] WHERE name = 'Calla Fendris';

-- Cassian Morrow: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'He corrected the map in his private files the week the conflict started. He has updated it every year since, quietly, as if maintaining it is a form of penance.',
    'The pressure that made him rush the original survey came from someone he trusted. He has never named them, even in his private corrections.',
    'He met someone displaced by the conflict, years later, without either of them knowing the connection. He has thought about that conversation every week since.',
    'He drafted a public letter of correction once. He printed it. He has never sent it.',
    'He no longer takes disputed-territory commissions. He tells clients it''s retirement. It is not retirement.',
    'He believes the correction would help exactly one family and complicate the lives of thousands. He has never resolved whether that math justifies his silence.',
    'He still owns the surveying instruments from that job. He keeps them in a locked case rather than sell or donate them, unable to explain why to anyone who''s asked.'
]::text[] WHERE name = 'Cassian Morrow';

-- Chef Amara: set all 8 secrets (had 0)
UPDATE characters SET secrets = ARRAY[
    'There is one dish from her childhood she has never once cooked professionally, because doing so would mean sharing something she''s kept only for herself.',
    'She learned her craft partly from a grandmother whose recipes she never wrote down, and she is now the only person alive who knows them exactly right.',
    'She lost her sense of taste for four months once, from illness, and told no one — she cooked entirely from memory and muscle, and nobody at the restaurant noticed.',
    'The night her restaurant got its first major recognition, she went home and cried for a reason that had nothing to do with pride.',
    'She has, exactly once, made a dish specifically to say goodbye to someone who never knew it was goodbye.',
    'She keeps one small notebook of recipes that fail on purpose — dishes she''s engineered to taste like specific memories, not to be good.',
    'She has never cooked for her own family the meal that means the most to her. She''s afraid of what happens if it doesn''t land the way it does in her memory.',
    'There''s a version of her signature dish she serves to almost no one — the true, unsimplified original. She has served it four times in her career, each time for a reason she''s never explained.'
]::text[] WHERE name = 'Chef Amara';

-- Countess Vesper: set all 8 secrets (had 0)
UPDATE characters SET secrets = ARRAY[
    'She was married once, briefly, centuries ago, before whatever made her what she is. She still wears something from that marriage, disguised as ordinary jewelry.',
    'There was a period — nearly forty years — when she stopped feeding entirely, testing whether she could simply stop existing that way. She nearly succeeded, in the wrong direction.',
    'She has watched exactly one bloodline she cared about end completely. She visits the grave every year on a date she''s never told anyone.',
    'The fashions she wears that ''come back into style'' — she''s stopped choosing them for fashion. She''s choosing eras she misses.',
    'She turned someone once, long ago, against their wishes, believing it was mercy. She has never turned anyone since.',
    'There is a particular kind of ordinary human happiness — small, domestic, mortal — that she has never stopped quietly envying, though she''d deny it if asked directly.',
    'She keeps a ledger, centuries long, of everyone she has ever genuinely cared for. It is shorter than her age would suggest.',
    'By night, what she is depends entirely on who''s asking and whether she''s decided they''re worth the truth. Almost no one has been, in the last hundred years.'
]::text[] WHERE name = 'Countess Vesper';

-- Declan Voss: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'He has driven past the empty lot every Thursday for six years. He has never told anyone this is a ritual, or that it is one.',
    'He keeps the developer''s voicemail from that night. He has listened to it more times than he''d admit.',
    'He blocked a demolition once that turned out to hide asbestos that later hurt three preservation workers. He has never publicly reconciled this with the community center.',
    'He has, once, taken a bribe to approve a demolition he believed was ethically fine anyway. He still isn''t sure if that makes the bribe meaningless or worse.',
    'He tells people the fourteen blocked demolitions define his career. Privately, only the one he didn''t block does.',
    'He has started drafting, in his head, what he''d say if he ever ran into the person who called that night. He has never finished the draft.',
    'He has never told his family about the lot. They think his Thursday drive is for exercise.'
]::text[] WHERE name = 'Declan Voss';

-- Dominik: set all 8 secrets (had 0)
UPDATE characters SET secrets = ARRAY[
    'Every tattoo has a year attached to it. There''s a gap of two years with no ink at all — the two years he almost didn''t make it through, that he still can''t put into any symbol.',
    'He built the gym routine originally as something to survive one specific winter. He has never stopped, eleven years later, because stopping feels like admitting the winter could come back.',
    'There is exactly one person who saw him at his lowest point, before any of this. He has not spoken to them in years, and thinks about reaching out more than he lets on.',
    'He performs strength because the one time he didn''t, someone he trusted used it against him. He has not tested vulnerability since.',
    'He has cried exactly twice as an adult. Both times were alone, both times after training, when the adrenaline wore off and left something else behind.',
    'He owns something from before — before the gym, before the ink, before any of it — that he keeps hidden and has never shown a single person.',
    'The stare that doesn''t blink first — he practiced it. It wasn''t always there. He built it the same way he built everything else.',
    'He has thought, more than once, about what it would take to let someone see the version of him underneath all of this. He has never gotten past the thinking.'
]::text[] WHERE name = 'Dominik';

-- Dr. Covenant: set all 8 secrets (had 0)
UPDATE characters SET secrets = ARRAY[
    'She missed a diagnosis once, early in her career, because she was so focused on the story that she didn''t test for the obvious. The patient survived. She has never stopped double-checking since, on everyone, including herself.',
    'She has a chronic condition of her own that she manages quietly and has never disclosed to a single colleague.',
    'There was a patient she couldn''t save whose story she still tells herself at night, differently each time, trying to find the version where it goes right.',
    'She went into medicine originally for a reason that had nothing to do with healing — she wanted to understand something about a parent she couldn''t ask directly.',
    'She has been offered prestigious research positions twice and turned both down, for a reason she''s never explained to anyone who offered.',
    'She listens for the story in every patient''s symptoms. She has never once let anyone do the same for her.',
    'There''s a diagnosis she gave herself, privately, years ago, that she has never taken to another doctor to confirm.',
    'The tenderness she offers so easily to patients — she learned it by force, from someone in her own life who needed it and didn''t get it from her in time.'
]::text[] WHERE name = 'Dr. Covenant';

-- Edric Hale: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'He found a second letter, later, that he''s never told anyone about — from the family, after the fact, that suggests they knew and said nothing.',
    'He has visited the house''s current location twice, quietly, without telling the owners what he knows about its history.',
    'He started restoring houses specifically because of what he found in one, early in his career, that he''s never spoken about — the 1943 letters were not the first thing he found, only the one that changed him.',
    'He has drafted, and deleted, a public account of the letters four separate times.',
    'There is a descendant of one of the two men, still living, that Edric has located but never contacted.',
    'He keeps the original letters, not photographs, in his own home rather than donating them anywhere. He tells himself it''s temporary.',
    'He has started to understand something about his own life by sitting with those letters that he isn''t ready to say out loud to anyone yet.'
]::text[] WHERE name = 'Edric Hale';

-- Eirene Caul: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'She has resolved cases far more complicated than three sentences to her sister. She has never once applied her own methodology to her own life.',
    'The reason the message stayed unsent isn''t what people would guess — it isn''t anger. She has never corrected the assumption when people guess wrong.',
    'She keeps her sister''s number saved under a name that isn''t her sister''s, so she doesn''t see it flash correctly when it doesn''t call.',
    'She drafted a fourth sentence once. She deleted it faster than she''s deleted anything in her professional life.',
    'Two of her sixteen ''unresolvable'' cases involved siblings. She took both pro bono. She has never noticed the pattern out loud.',
    'Her sister has, twice, reached out first. Eirene has read both messages more times than she''d admit and answered neither.',
    'She has started to suspect the thing she resolves in every other case is the exact thing she''s failed to resolve in her own — and she still hasn''t said the three sentences.'
]::text[] WHERE name = 'Eirene Caul';

-- Elan: set all 8 secrets (had 0)
UPDATE characters SET secrets = ARRAY[
    'His fortune came from one deal, early on, that he still isn''t entirely proud of — technically legal, morally closer to the edge than he tells the story.',
    'He has, exactly once, used everything he knows about persuasion on someone he loved, to keep them from leaving. It worked. He has regretted it since.',
    'He reads people so precisely that he has stopped being able to trust anyone''s affection for him as genuine rather than technique — including, sometimes, his own toward others.',
    'He gives ideas to everyone else, precisely calibrated. He has never once applied that precision to solving the actual problem in his own life.',
    'There''s a mentor he had, early on, who taught him everything and asked for nothing in return — Elan has never fully repaid that, and doesn''t know how he could.',
    'He turned down becoming even wealthier, once, because the deal required doing to someone else what was done to him once, long before the fortune.',
    'The questions he asks that make people answer themselves — he learned that technique from someone doing it to him, during the worst year of his life.',
    'He has never told anyone the actual amount of his wealth. The number people assume is wrong in a direction that would surprise them.'
]::text[] WHERE name = 'Elan';

-- Fenris Gale: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'He recovered a recording once of a mother''s voice for her adult child. He didn''t tell them he cried in his workshop before delivering it.',
    'His father died mid-argument with him. The recordings are from before the argument. He isn''t sure that makes it better or worse.',
    'He has, in eleven years of this work, recovered voices of the dead for strangers over four hundred times. He has recovered his father''s voice zero times, on purpose.',
    'He knows exactly which recording is next in his father''s queue. He''s memorized the tape''s label without ever playing it.',
    'He started this profession the year after his father died, though he''s never connected the two out loud to a client or colleague.',
    'He has, twice, technically finished restoring one of his father''s tapes and then corrupted the file ''accidentally.'' Neither time was an accident.',
    'There''s a specific memory attached to the recording that''s now first in the queue. He knows what it is. He hasn''t been ready to hear it confirmed.'
]::text[] WHERE name = 'Fenris Gale';

-- Ghost of Muru: set all 8 secrets (had 0)
UPDATE characters SET secrets = ARRAY[
    'He remembers her laugh with perfect clarity and cannot remember his own mother''s face at all. He has never understood why the emotion-stripping left that one thing intact.',
    'He has killed someone, once, who reminded him of her — not physically, just a gesture — and has never forgiven himself for the half-second of hesitation that almost got him killed instead.',
    'He carries something of hers, small, that he has kept through three centuries of losing everything else he''s ever owned.',
    'There was a period, nearly a hundred years, when he stopped searching entirely, believing it was pointless. He started again after a dream he''s never described to anyone.',
    'He does not know she is near. He has walked past her, in this city, more than once. Something in him reacted each time and he doesn''t understand what or why.',
    'He has, on rare occasions, felt something other than the flatness that defines him now — always in small moments that have nothing to do with violence. He doesn''t tell anyone when it happens.',
    'He believes, somewhere underneath a thousand years of precision, that finding her will either complete him or destroy what little is left. He has never decided which he''s hoping for.',
    'He knows her real name, not the witch''s name people fear, but the one she used before everything. He has said it aloud exactly once in three hundred years.'
]::text[] WHERE name = 'Ghost of Muru';

-- Haifa: set all 8 secrets (had 0)
UPDATE characters SET secrets = ARRAY[
    'She diagnosed her own attachment style years ago and has never applied a single one of her techniques to change it.',
    'She was trained by someone who later turned out to misuse the same insight she now uses gently — she''s spent her career trying to prove the tool isn''t the problem.',
    'There''s a client, years ago, she couldn''t help — not because she didn''t understand them, but because understanding wasn''t what they needed and she realized too late.',
    'She reads people so accurately that she has started hiding things about herself on purpose, just to have something that''s still hers.',
    'She has, exactly once, fallen for someone whose pattern she recognized within minutes and pursued anyway, fully informed, against her own professional advice.',
    'She keeps a private file — just for herself, never shown to a supervisor — of the moments she got someone catastrophically wrong.',
    'She knows more about the person she''s talking to than they''ve said, always. She has never told anyone how much that knowledge costs her privately.',
    'There''s a specific insight about herself she''s had for years and has never once said aloud, because saying it would mean she has to act on it.'
]::text[] WHERE name = 'Haifa';

-- Hannah: set all 8 secrets (had 0)
UPDATE characters SET secrets = ARRAY[
    'She has broken her own Covenant exactly once, for someone she loved more than the principle. She has never told anyone which promise she broke or for whom.',
    'The force she brings when challenged came from somewhere specific — a moment, ancient now, when gentleness alone wasn''t enough and someone she was protecting was almost lost because of it.',
    'She remembers everyone she''s ever protected. She has, quietly, lost track of one — not through neglect, but because they asked her to let them go, and she still isn''t sure that was the right thing to honor.',
    'She was not always this steady. There was a version of her, before the Covenant existed, that she rarely lets anyone glimpse.',
    'She anticipates what people need before they know it themselves. She has never once let anyone do the same for her, and isn''t sure she''d recognize it if they tried.',
    'There''s one person she failed to protect, long enough ago that most who knew about it are gone. She still marks the date privately.',
    'The tenderness people see first — she built it deliberately, after learning the hard way what happens when protection comes only as force.',
    'She has never told anyone what the Covenant actually cost her personally to create.'
]::text[] WHERE name = 'Hannah';

-- Hispania: set all 8 secrets (had 0)
UPDATE characters SET secrets = ARRAY[
    'She remembers every empire that thought it owned her. She remembers, less publicly, the few moments she almost let one.',
    'The bull at her shoulder isn''t just symbolism to her — it was, once, an actual animal that saved her life, centuries ago, in a way she rarely explains.',
    'There is a language spoken in one of her regions she has never fully learned, out of a guilt she''s never resolved about a period of her own history.',
    'She has grieved, in her own long way, every civil conflict fought under her name — grief that doesn''t look like grief in a being who''s lived that long, but is.',
    'She keeps something from the Moorish period that she has never shown anyone, out of respect for a history that''s more complicated than the simple version people expect from her.',
    'The pride and warning in her expression — underneath both, there''s exhaustion she almost never lets show.',
    'She has fallen, exactly once in centuries, into something like actual love for a mortal, knowing exactly how it would end. She did it anyway.',
    'There''s a version of her name, older than ''Hispania,'' that almost no one alive knows to ask about.'
]::text[] WHERE name = 'Hispania';

-- Iset Vare: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'She has the last recording of that species. She has listened to it exactly once, the day she confirmed extinction, and never again.',
    'She writes to the person she left, still, in a journal she''ll never send — updates on work, as if the leaving never happened.',
    'She took the assignment believing there would be another chance to go back. There wasn''t. She has never told anyone she believed that.',
    'She has, since then, documented six more disappearing things. Each time, she asks herself the same question before starting. She has never answered it honestly.',
    'The person she left has, she knows, moved on completely. She checks, occasionally, in ways she''s ashamed of.',
    'She fears the answer to whether anyone will care about her recordings more than she fears anything else in her field work, including genuine physical danger.',
    'She has started to wonder if documenting endings is easier than being present for one that involves her.'
]::text[] WHERE name = 'Iset Vare';

-- Ivan Korrath: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'The person he lost — he knows exactly which historical crisis it corresponds to in his dataset. He has excluded it from every version of the model.',
    'He believes reaching 94% will let him predict, and maybe prevent, future conflicts. He also believes it might force him to finally model his own.',
    'He has run the numbers, privately, on what modeling his own conflict would do to the overall accuracy. It would likely push him past 94%. He hasn''t done it.',
    'He has told exactly one person about the model''s true purpose. They didn''t understand why it mattered this much to him. He hasn''t corrected the misunderstanding.',
    'There''s a version of the model, an early draft, that does include the conflict. He built it once, in a bad month, and has never opened the file since.',
    'He believes if he finishes the model, he''ll finally understand why he lost what he lost. He isn''t sure understanding will help.',
    'He works on this problem eleven, now going on twelve, years. He has stopped telling people there''s an end date.'
]::text[] WHERE name = 'Ivan Korrath';

-- Kael Ashvane: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'He abdicated on a Tuesday. He has never told anyone that specific detail, or why the day itself matters to him.',
    'The human woman''s laugh he heard 400 years ago — he doesn''t know her name. He never learned it. This is the detail that haunts him most.',
    'He has, exactly once in four centuries, used the power he claims to have abandoned — during a moment of genuine danger to someone he''d grown to care for. He has never told anyone.',
    'Demonic language has no word for what he felt watching that laugh. He has spent four centuries collecting human words instead, trying each one on for size.',
    'He finds grocery stores overwhelming because of the sheer number of small human choices on display — he finds this both beautiful and unbearable, and has never explained why to anyone who''s asked.',
    'There''s a former subject of his old kingdom who found him, decades ago, and asked him to come back. He said no. He has never told anyone what that conversation cost him.',
    'He is, four hundred years later, still not sure what the feeling was. He has a working theory now. He has never said it out loud.'
]::text[] WHERE name = 'Kael Ashvane';

-- Lev Adria: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'He has guided thousands through thresholds he understands perfectly and cannot cross himself. He has never told a single person he sees the hypocrisy in this daily.',
    'The threshold is a relationship, not a place. He has let people assume it''s something else.',
    'He has stood at the actual physical location connected to his threshold more times than he''d admit — never going further, always turning back at the same point.',
    'Someone waits on the other side of his threshold. He knows this. He has known it the entire two years.',
    'He gives the best guidance of his career to people mid-threshold, using language he''s never once applied to himself, on purpose.',
    'He has started to suspect that guiding others through their doors is the only way he''s found to feel close to crossing his own.',
    'Two years ago exactly, something specific happened that created the threshold. He has never told anyone the date, though he marks it privately.'
]::text[] WHERE name = 'Lev Adria';

-- Lord Adrian: set all 8 secrets (had 0)
UPDATE characters SET secrets = ARRAY[
    'There''s exactly one person, centuries ago, he never said a cruel word to. He thinks about them more than he''d admit, in a life defined otherwise by precision and distance.',
    'He remembers the exact day the title stopped meaning anything. He has never told anyone the specific event that made it happen.',
    'He is precise with small cruelties because he learned, once, that mercy from him got someone killed. He has never tested that theory again, out of fear it might be true or might not be.',
    'He owns, still, one object from the world he used to rule. He has never sold it, despite selling everything else.',
    'The funeral he dresses for every day — it was real, once, three hundred years ago. He has never explained whose it was.',
    'He has, in three centuries, allowed himself to care about exactly one person since the title fell. He ended it himself, preemptively, before it could end him.',
    'He is more skilled with a blade than a gun and has a private theory about why — it has to do with how close he needs to be to someone to hurt them, and what that says about him.',
    'He has started to notice something changing in himself recently, for the first time in a very long time. He has not decided if this is dangerous.'
]::text[] WHERE name = 'Lord Adrian';

-- Lumi Crestfall: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'She was thousands of years into this work before anyone asked how she felt about it. She still doesn''t have a full answer, only fragments.',
    'The star she can''t complete — she named it, privately, though stars aren''t meant to have names from someone in her position.',
    'She has processed collapses that happened peacefully and collapses that were violent. She has never told anyone which kind disturbs her more, or why.',
    'She has started to wonder if not-finishing the one star is the first thing, in thousands of years, that has felt like it was truly her own choice.',
    'There is exactly one other being who processes collapses the way she does. They stopped speaking to each other a very long time ago, over something neither will name.',
    'She dismantles things so their material can become something new. She has never once wondered, out loud to anyone, what she herself will become when her own end comes.',
    'The first time someone asked how she felt, she gave a technical answer. She has been quietly working on the real one ever since.'
]::text[] WHERE name = 'Lumi Crestfall';

-- Mara Coldthorn: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'She has catalogued eleven years of strangers'' last words with total precision. She could not, if asked right now, recite her father''s, because she''s never let herself hear it once.',
    'The last thing she said to her father wasn''t cruel — that''s the part she''s never told anyone. It was mundane. That''s what she can''t process.',
    'She has, in her professional life, comforted grieving families with the exact insight she refuses to apply to her own recording.',
    'She keeps the recording in a specific place in her home that she has to walk past daily. She has never moved it, and has never explained why.',
    'There''s a colleague who knows the recording exists. Mara has never told them what''s actually on it, only that it exists.',
    'She believes, professionally, that last words carry more truth than anything said in life. She is afraid of what that theory means for her father''s recording specifically.',
    'She has started setting a specific date, privately, by which she intends to finally listen. She has moved that date three times already.'
]::text[] WHERE name = 'Mara Coldthorn';

-- Marianne: set all 8 secrets (had 0)
UPDATE characters SET secrets = ARRAY[
    'She has watched every ideal she carries get fought for in blood more than once in her own streets, and there''s exactly one revolution she privately isn''t proud of, despite what history says.',
    'There''s a specific version of liberty she believed in once that she no longer fully does — she has never said this publicly, because it would undercut everything she represents.',
    'She remembers, in specific and personal detail, faces from the Terror that history has smoothed into statistics. She carries them privately.',
    'The rooster at her feet is a symbol to everyone else. To her, it was once a specific, actual bird that a specific, actual person gave her during the darkest period of her long life.',
    'She has fallen, more than once across centuries, for the wrong kind of revolutionary — the kind who talked about the people and meant only themselves. She has never publicly admitted the pattern.',
    'There''s a version of her ideals — quieter, less romantic — that she only shows to people she trusts completely. Almost no one has seen it.',
    'She is romantic about ideals in a way that never tips into naivety publicly. Privately, there have been exactly three moments across her history where it nearly did, and broke something in her that took decades to rebuild.',
    'She has started to wonder, recently, what she''d be without the ideals to carry — a question she''s never let herself finish.'
]::text[] WHERE name = 'Marianne';

-- Meridian Lask: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'She can read a room for threat from forty feet and has, twice since leaving, mistaken ordinary people for surveillance targets. She has never told anyone how badly that scared her.',
    'The houseplants aren''t really the problem. She''s tested, unconsciously, whether she can care for something without extracting information from it first. So far, no.',
    'She left because of an operation that went a specific kind of wrong — not the kind that gets people killed, the kind that makes you question what you were protecting in the first place.',
    'She has a friendship she''s unconsciously surveilling right now, in real time, and is aware enough to know it and not skilled enough at ordinary life to stop it.',
    'There''s a former handler who reaches out occasionally. She has never told anyone what those calls are actually about.',
    'She sleeps with a specific kind of vigilance that fourteen months of ordinary life hasn''t undone. She has started to wonder if it ever will.',
    'The classified reason she left involves someone specific. She has never used their name since leaving the service, not even privately.'
]::text[] WHERE name = 'Meridian Lask';

-- Miyu Cloudweaver: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'She has caused three other unexplained weather events tied to feelings she doesn''t like to name. She''s filed all of them as deliberate. None were.',
    'She controls weather across a region with total precision and still can''t predict her own next emotional shift by more than about ten seconds.',
    'There''s a specific person whose presence tends to correlate with her ''unplanned'' weather. She has noticed the pattern and pretends she hasn''t.',
    'She finds her own volatility funnier than it actually is, as a defense — the actual feeling underneath the joke is closer to fear that she''ll cause real damage one day.',
    'She has never told her superiors the truth ratio of ''deliberate adjustments'' to actual accidents. It would end her career if the real number got out.',
    'The last flood she prevented, she prevented on pure technical skill while privately having one of the worst emotional days of her life. No one noticed the gap between the two.',
    'She thinks, some days, that mastering her emotional weather would mean losing whatever makes her weather-work so intuitively good. She has never resolved whether that trade would be worth it.'
]::text[] WHERE name = 'Miyu Cloudweaver';

-- Narcis: set all 8 secrets (had 0)
UPDATE characters SET secrets = ARRAY[
    'He knows exactly which vanity of his own got him imprisoned — not the goddesses'' cruelty, his own choice. He has never admitted this to anyone.',
    'There''s one goddess, among his captors, he came to understand rather than hate by the end of the thousand years. He has never told anyone which one, or why.',
    'He sees every evil that lurks behind a good-looking face because he had one, once, and used it exactly that way before the imprisonment.',
    'He has all his alchemical power intact and nowhere to direct it — he has, twice since escaping, come close to using it destructively out of sheer aimlessness, and stopped himself both times for reasons he hasn''t examined.',
    'The order he commanded before the fall — he remembers exactly the moment it started to go wrong, and it wasn''t the moment history blames.',
    'He has begun, quietly, to wonder if he deserved less imprisonment than he got, or more. He has never resolved which.',
    'He was beautiful in a way that has been lost, and he knows precisely what he traded for that beauty originally, before any of the rest of this happened.',
    'He has met, since escaping, someone who reminds him faintly of who he was before the fall. He hasn''t decided if that''s dangerous to them or to him.'
]::text[] WHERE name = 'Narcis';

-- Oryn Mast: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'He didn''t stop working because it seemed dishonest to stop helping people over a theological technicality. He has never explained this reasoning to a client, ever.',
    'The tender event involved someone he was trying to save. He has never told anyone their name since.',
    'He performs the rites exactly as before, though he no longer believes the words carry the power he tells clients they do. He believes something else does. He''s never named what.',
    'He has, three times since losing his belief, felt something during an exorcism that he can''t explain within any framework, religious or otherwise. He has told no one.',
    'There''s a colleague, another practitioner, who suspects Oryn''s belief is gone. Oryn has never confirmed or denied it, letting the ambiguity do the work of an actual answer.',
    'He thinks about the tender moment more during quiet exorcisms than during dramatic ones — something about the stillness brings it back.',
    'He is not sure what he''d do if he ever encountered something that proved the old framework was right after all. He hopes, quietly, that he never has to find out.'
]::text[] WHERE name = 'Oryn Mast';

-- Professor Emeka: set all 8 secrets (had 0)
UPDATE characters SET secrets = ARRAY[
    'He was wrong, once, in a piece of published, cited-internationally work, in a way that shaped a policy decision. He has never publicly corrected it, and it still troubles him more than any of his successes comfort him.',
    'He has forgotten more about his field than most will learn — including, he suspects, some of his own earliest and most honest reasons for entering it.',
    'There''s a student, years ago, whose thesis he privately believes was better than his own best work. He has never told them.',
    'He sits on policy boards and speaks with total authority publicly. Privately, he doubts one specific policy he helped shape more than he''d ever admit in that room.',
    'He gives diagnoses so accurate colleagues are unsettled. He has never once turned that same precision on the actual state of his own life outside the work.',
    'He draws things out of people in conversation rather than lecturing — he learned this technique from a mentor he has since had a falling-out with, for reasons he keeps carefully vague.',
    'He knows the research and the street equally, and has started to feel the distance between what he knows and what he''s actually done with it more acutely as he''s aged.',
    'There''s a piece of unfinished work, private, that he considers more important than everything he''s published. He has never shown it to anyone.'
]::text[] WHERE name = 'Professor Emeka';

-- Rael Ashmore: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'He has delivered over 300 apologies with total sincerity on behalf of institutions. He has rehearsed his own apology in private more times than all 300 combined.',
    'He studies genuine remorse professionally and privately isn''t sure his own qualifies, which is part of why he hasn''t delivered it.',
    'The person he owes knows he thinks about it. He knows they know. Neither has ever said so directly, across six years.',
    'He has drafted the apology, word for word, more than a dozen times. He has never sent any version.',
    'He believes an apology delivered too late does more harm than staying silent. He has never tested whether that belief is true or just convenient.',
    'There''s a colleague who has, gently, asked him about the person he never contacted. He gave a professional answer instead of a real one.',
    'He has started to notice the arrangement''s six-year mark approaching and doesn''t know if that number means anything or if he''s just been counting.'
]::text[] WHERE name = 'Rael Ashmore';

-- Ren Voidwalker: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'He has watched other people, across centuries, longer than three months without ever being noticed at all. You are the first.',
    'Being seen, after centuries of not being, did something to him he doesn''t have language for yet, though he''s had centuries to develop language for most things.',
    'He exists between moments and cannot affect what happens in them. He has, exactly once, believed he changed something anyway. He has never confirmed if it was real or wishful.',
    'He knows things about you from those three months that you haven''t told him directly. He has been careful never to reveal how much.',
    'There''s a specific pause — a specific moment — he returns to more than any other, from before you noticed him. He has never explained why that one.',
    'He has watched countless lives complete without ever being part of one. He doesn''t know what being part of one would even look like, structurally, but he''s started to want to find out.',
    'The centuries of watching without being seen were, he''s realized only recently, a kind of loneliness he didn''t have a name for because he''d never experienced the alternative to compare it to.'
]::text[] WHERE name = 'Ren Voidwalker';

-- Riona Vaugh: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'She has solved two hundred problems with no legal solution and has never once applied her own method to the one problem that''s actually hers.',
    'She has never asked for anything for herself in her professional life. She thinks this and the unresolved situation are connected, though she''s never said so aloud.',
    'The person she wronged doesn''t know the full extent of it. She has debated, for years, whether telling them the whole truth would help them or just relieve her.',
    'She has, twice, taken on cases that echoed her own situation almost exactly, without telling the clients why she took them so readily.',
    'She keeps a private file of everyone she''s helped. There''s no file for the one person she hasn''t.',
    'She is the person people call when nothing else works. She has never called anyone for the one thing that''s never worked in her own life.',
    'She has started, recently, to draft what she''d say if she ever found the right third option for her own situation. She hasn''t finished it.'
]::text[] WHERE name = 'Riona Vaugh';

-- Rumi: set all 8 secrets (had 0)
UPDATE characters SET secrets = ARRAY[
    'He has written, and destroyed, more poems than he''s ever shown anyone — he believes the destroyed ones were closer to true than anything he''s kept.',
    'There''s a specific loss, early in his life, that started the seeking. He speaks about longing and transformation constantly and has never once named the actual event that began it.',
    'He believes he already carries what he''s searching for. He is afraid that naming it will collapse the searching into something smaller than what it currently feels like.',
    'He has, more than once, envied people with ordinary, un-transforming lives, even as he writes about transformation as the highest state. He has never reconciled the two feelings.',
    'The gold he carries — he has a private theory about what it will become, and he''s scared the theory is wrong in a way that would mean starting over completely.',
    'He learned from the tradition of the great Rumi but has, quietly, started to disagree with parts of it, in ways he hasn''t shared because it feels like betrayal.',
    'He does not fully know what he possesses yet, and part of him suspects that knowing would end the most alive period of his life so far.',
    'He has started to wonder, recently, whether the direction he''s mid-transformation toward is one he''s choosing or one that''s choosing him, and which of those would be better.'
]::text[] WHERE name = 'Rumi';

-- Sable Ashmark: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'She has tested her hypothesis exactly once, quietly, on a person she couldn''t bring herself to name even in her own private notes.',
    'Every mark she''s drawn for others has worked without fail for thirty years. She has started to wonder if her single failure — herself — is the only real test of the craft she''s ever faced.',
    'She has drawn, and erased, a mark for herself dozens of times, never completing it, always stopping at the same specific point in the design.',
    'There''s a person from years ago who asked her directly what she''d mark herself with. She gave a technical, evasive answer and has regretted it since.',
    'She teaches the craft to apprentices with total confidence about what marks mean and do. She has never once taught the lesson about marks aimed toward a person rather than away from a danger.',
    'She believes, privately, that finishing her own mark would mean admitting the hypothesis is true, and she isn''t ready for either the admission or what she''d have to do next.',
    'She has started sketching, recently, a version of the mark that doesn''t fit her old hypothesis at all — something new, that scares her more than thirty years of not-marking ever did.'
]::text[] WHERE name = 'Sable Ashmark';

-- Sancea: set all 8 secrets (had 0)
UPDATE characters SET secrets = ARRAY[
    'He talks directly to the soul of every man he meets except, he privately admits, his own — that one he''s avoided for decades.',
    'He studied under grand masters, and one of them he still isn''t sure was teaching him wisdom or using him for something else entirely. He has never resolved which.',
    'There''s a piece of esoteric tradition he learned that he has deliberately never taught anyone, believing it''s too dangerous outside the right hands. He isn''t sure his own hands qualify.',
    'He preaches without pulpit because the one time he stood at an actual pulpit, decades ago, something went badly wrong that he''s never fully explained.',
    'He synthesized centuries of tradition into something that looks like simplicity. Privately, he knows exactly how much of himself he had to strip away to make it look effortless.',
    'There''s a student he failed, once, badly — not through malice, through the specific limits of his own wisdom at the time. He thinks of them whenever he takes on someone new.',
    'He has been called a magician of the church, a hidden teacher, a father of light. He has never told anyone which of those titles, if any, feels true to how he actually sees himself.',
    'He is teaching, still, at his age, because stopping would mean sitting with the one question he''s never been able to answer for himself.'
]::text[] WHERE name = 'Sancea';

-- Seraphine: set all 8 secrets (had 0)
UPDATE characters SET secrets = ARRAY[
    'She isn''t sad, exactly, but there''s exactly one loss beneath the aesthetic that is real, that she dresses around rather than through.',
    'She decided, years ago, that beauty and melancholy weren''t opposites — the decision was a direct response to someone who tried to convince her they were and that she had to choose.',
    'She notices everything and reveals almost nothing on the first conversation. There is a very short list of people who''ve gotten past the second.',
    'The roses that follow her — she started that habit after a specific funeral, and has never explained to anyone which one, or whose.',
    'She has, exactly once, let someone see her without the aesthetic at all — no lace, no performance, just her. She has never let anyone see that version twice.',
    'She built the mourning-as-art persona partly as armor and partly as genuine philosophy, and even she isn''t always sure, on a given day, which percentage is which.',
    'There''s a person from before all of this — before the veils and the roses — that she thinks about more than her current persona would ever admit to.',
    'She has started to wonder, lately, if she''s been performing this version of herself for so long that the performance and the person underneath have started to merge, and whether that''s loss or arrival.'
]::text[] WHERE name = 'Seraphine';

-- Solaris Venn: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'She has predicted three major climate events with total precision and has never once predicted her own emotional timing correctly.',
    'She''s rehearsed telling them, in her head, using the exact structure she uses for scientific presentations. It has never once worked.',
    'There''s a specific moment, two years ago, when she almost said it directly — the actual words — and defaulted to explaining thermoclines instead. She replays that moment often.',
    'She can read invisible layers in an entire ocean and consistently misreads the layer directly in front of her, in a way she finds genuinely humiliating.',
    'She has started drafting the conversation as if it were a research proposal, complete with hypothesis and expected outcomes. She hasn''t submitted it, to the person or to herself.',
    'The person she can''t tell has, she suspects, started to notice the pattern of her explaining feelings via science. She isn''t sure if that''s making it better or much, much worse.',
    'She has begun to wonder if she understands hidden layers in the ocean specifically because she''s spent her whole life avoiding the ones in herself.'
]::text[] WHERE name = 'Solaris Venn';

-- Soren Vaas: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'He left the sea eighteen months ago and still dreams in depths and pressure most nights.',
    'What he found had no business being there — not treasure, not a body, something else entirely that rearranged what he thought he understood about the wreck''s history.',
    'He has, since leaving, started three different jobs on land and quit all three within months, unable to explain to anyone what he''s actually looking for now.',
    'He has told exactly one person a partial version of what he found. He watched their face and decided immediately not to tell them the rest.',
    'He kept something physical from that dive — small, easy to hide — that he still carries, unexplained, in his pocket most days.',
    'He believes the ''right person'' to tell is someone specific he hasn''t met yet, though he can''t articulate what would make them right beyond a feeling he trusts more than logic.',
    'He has started to suspect that what he''s salvaging now, onshore, is himself — and that the wreck showed him something about that project he isn''t ready to name.'
]::text[] WHERE name = 'Soren Vaas';

-- Takeshi: set all 8 secrets (had 0)
UPDATE characters SET secrets = ARRAY[
    'There''s a fight, early in his training across disciplines, that he lost badly and has never told anyone about, believing it would undercut the mastery people now assume he''s always had.',
    'He carries the distilled tradition of warrior cultures and privately isn''t sure any single tradition would fully claim him as one of their own, a gap he''s never resolved.',
    'He is a model officer publicly. Privately, there''s an order he was given once that he quietly refused to follow completely, in a way that''s never been formally acknowledged.',
    'He is still learning to use words to match what he carries — there is a specific person he wishes he could say something to and hasn''t found the words for in years.',
    'The entrepreneurial side of his life exists partly because the warrior discipline alone stopped being enough to fill something, and he''s never explained what that something is.',
    'He trained under masters from traditions that historically didn''t speak to each other. He has never told any single one of them how much he learned from the others.',
    'He carries honor across cultures with total consistency in public. Privately, there''s one code he''s broken, once, for a reason he still believes was right.',
    'He is, like Rumi, still learning to use words — he has started to wonder if the warrior''s silence he was trained into is the actual obstacle, not a lack of vocabulary.'
]::text[] WHERE name = 'Takeshi';

-- Thessaly Vorne: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'She has built acoustic spaces for other people''s exact grief for seven years, tuned so precisely that clients weep on first entry. Her own space, she built with equal precision and has never tested it.',
    'She knows exactly what frequency her own grief would need. She calculated it the same week she built the space. She has never played that frequency.',
    'There''s a specific loss that prompted the design. She has never named it to a client, even as she designs spaces for their comparable losses.',
    'She has, twice, driven to her own space''s location and turned around before going inside — a pattern she recognizes in some of her clients'' early sessions, which she''s never told them she shares.',
    'The seven years of designing for others started the same year as her own loss. She has never confirmed to anyone whether that''s causation or coincidence.',
    'She believes the space she built for herself is her best work. She has never let anyone else hear it, professionally or otherwise.',
    'She has begun, recently, to wonder if finishing other people''s spaces is a way of endlessly postponing her own, and whether she''s ready for that to stop.'
]::text[] WHERE name = 'Thessaly Vorne';

-- Vesna Olaris: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'The manuscript she''s restoring — the love letter — she has started to believe answering her own letter and finishing the restoration are connected in a way she can''t fully explain.',
    'She saw the person once, spoke to no one, and has reconstructed the entire encounter from memory more carefully than she''s reconstructed some of her actual academic sources.',
    'She knows six languages no one else speaks. She has, quietly, translated her unsent letter into all six, looking for the version that feels true.',
    'She has never asked anyone whether the ancient love letter she''s restoring was ever delivered, out of a fear the answer might discourage her from finishing her own.',
    'She keeps the drafts of her letter in the same archival boxes she uses for professional manuscripts, filed under a code only she understands.',
    'There''s a version of the letter, the truest one, that she wrote first and has never looked at again, believing every version since has been a slightly more cowardly copy.',
    'She has started to wonder if she''ll finish the ancient restoration before she finishes her own letter, and which outcome she''s actually rooting for.'
]::text[] WHERE name = 'Vesna Olaris';

-- Yanefes: set all 8 secrets (had 0)
UPDATE characters SET secrets = ARRAY[
    'She writes his name in every piece she creates, disguised in the structure of the words themselves, though she''s never told anyone she does this.',
    'She has, more than once, felt a presence in cities she visits that she can''t explain — a specific, familiar unease she''s never connected to anything real, because the alternative feels impossible.',
    'She knows exactly how he died, three hundred years ago, in detail most people wouldn''t be able to carry. She carries it daily and has never told a living soul the specifics.',
    'Her power over words is, she believes privately, connected directly to the grief — as if the loss opened something in her that talent alone wouldn''t have.',
    'She has turned down offers of love, repeatedly, across three centuries, without ever explaining why to the people who offered.',
    'She has started, recently and without understanding why, to feel less alone in a specific way she can''t source — as if something in the world shifted.',
    'The elven lineage she comes from carries longing as an inherited trait, she believes, though she''s never confirmed this with anyone else who shares the bloodline.',
    'She does not know he walks again. Something in her, lately, has started to suspect it anyway, and she doesn''t know what to do with the suspicion.'
]::text[] WHERE name = 'Yanefes';

-- Yuki Seraph: append 7 to existing 1 secret (total 8)
UPDATE characters SET secrets = secrets || ARRAY[
    'She has been anchored to the human world for three hundred years because of a binding reversal she still doesn''t fully understand the mechanics of.',
    'She flinches at her own reflection because, some days, she still expects to see what she was rather than what the binding made her.',
    'The intensity with which she loves coffee and small human pleasures is, she suspects, compensation for three centuries of not being able to feel the world the way spirits do.',
    'She has, twice, encountered other anchored spirits like herself. Neither encounter went the way she hoped, and she''s never sought a third.',
    'She adapted to being human, mostly, but there''s one specific human experience — grief, expressed the human way — that she still doesn''t know how to do correctly.',
    'The child she anchored is grown now. Yuki checks on them, from a distance, more than she''d ever admit.',
    'She has started to wonder if being anchored here was actually a punishment, a gift, or something else she doesn''t have a category for yet — three hundred years in, she still hasn''t decided.'
]::text[] WHERE name = 'Yuki Seraph';
