# 《视与听》名单 → 豆瓣条目 复核清单

三种状态：

- `✓` 自动判定通过，名单里已带上 `doubanId`；
- `?` 找到候选但判定没过（原名/年份对不上），名单里**不带** `doubanId`，需人工核对；
- `–` 还没解析（多半是跑的时候被豆瓣限流了），换个时间重跑脚本即可接着解析。

`?` / `–` 的条目不影响灌库：`enrichThemeMovies` 会退回自己的豆瓣搜索路径。
人工核对后可用 `node tools/sightsound-seed/resolve-douban.js --only <rank>` 重解析，
或直接在 `sightsound.json` / `sightsound.params.json` 里手填 `doubanId`。

| | # | 名单片名（年份） | 源站导演 | 豆瓣条目 | 豆瓣年份 | 类型 | 分 |
|---|---|---|---|---|---|---|---|
| ✓ | 1 | Jeanne Dielman, 23 Quai du Commerce, 1080 Bruxelles（1975） | Chantal Akerman | [让娜·迪尔曼](https://movie.douban.com/subject/1868933/) | 1975 | movie | 160 |
| ✓ | 2 | Vertigo（1958） | Alfred Hitchcock | [迷魂记](https://movie.douban.com/subject/1297294/) | 1958 | movie | 160 |
| ✓ | 3 | Citizen Kane（1941） | Orson Welles | [公民凯恩](https://movie.douban.com/subject/1292288/) | 1941 | movie | 160 |
| ✓ | 4 | Tokyo Story（1953） | Yasujirō Ozu | [东京物语](https://movie.douban.com/subject/1291568/) | 1953 | movie | 160 |
| ✓ | 5 | In the Mood for Love（2000） | Wong Kar Wai | [花样年华](https://movie.douban.com/subject/1291557/) | 2000 | movie | 160 |
| ✓ | 6 | 2001: A Space Odyssey（1968） | Stanley Kubrick | [2001太空漫游](https://movie.douban.com/subject/1292226/) | 1968 | movie | 160 |
| ✓ | 7 | Beau travail（1998） | Claire Denis | [军中禁恋](https://movie.douban.com/subject/1306791/) | 1999 | movie | 145 |
| ✓ | 8 | Mulholland Dr.（2001） | David Lynch | [穆赫兰道](https://movie.douban.com/subject/1292217/) | 2001 | movie | 160 |
| ✓ | 9 | Man with a Movie Camera（1929） | Dziga Vertov | [持摄影机的人](https://movie.douban.com/subject/1293199/) | 1929 | movie | 160 |
| ✓ | 10 | Singin' in the Rain（1951） | Gene Kelly, Stanley Donen | [雨中曲](https://movie.douban.com/subject/1293460/) | 1952 | movie | 145 |
| ✓ | 11 | Sunrise: A Song of Two Humans（1927） | F.W. Murnau | [日出](https://movie.douban.com/subject/1295753/) | 1927 | movie | 160 |
| ✓ | 12 | The Godfather（1972） | Francis Ford Coppola | [教父](https://movie.douban.com/subject/1291841/) | 1972 | movie | 160 |
| ✓ | 13 | La Règle du jeu（1939） | Jean Renoir | [游戏规则](https://movie.douban.com/subject/1401261/) | 1939 | movie | 160 |
| ✓人工 | 14 | Cléo from 5 to 7（1962） | Agnès Varda | [五至七时的克莱奥](https://movie.douban.com/subject/1294565/) | 1962 | movie | 60 |
| ✓ | 15 | The Searchers（1956） | John Ford | [搜索者](https://movie.douban.com/subject/1292668/) | 1956 | movie | 160 |
| ✓ | 16 | Meshes of the Afternoon（1943） | Maya Deren, Alexander Hackenschmied | [午后的迷惘](https://movie.douban.com/subject/1437390/) | 1943 | movie | 160 |
| ✓ | 17 | Close-up（1989） | Abbas Kiarostami | [特写](https://movie.douban.com/subject/1303521/) | 1990 | movie | 145 |
| ✓ | 18 | Persona（1966） | Ingmar Bergman | [假面](https://movie.douban.com/subject/1294438/) | 1966 | movie | 160 |
| ✓ | 19 | Apocalypse Now（1979） | Francis Ford Coppola | [现代启示录](https://movie.douban.com/subject/1292260/) | 1979 | movie | 160 |
| ✓ | 20 | Seven Samurai（1954） | Akira Kurosawa | [七武士](https://movie.douban.com/subject/1295399/) | 1954 | movie | 140 |
| ✓ | 21 | The Passion of Joan of Arc（1927） | Carl Th. Dreyer | [圣女贞德蒙难记](https://movie.douban.com/subject/1293783/) | 1928 | movie | 145 |
| ✓ | 22 | Late Spring（1949） | Yasujirō Ozu | [晚春](https://movie.douban.com/subject/1307265/) | 1949 | movie | 160 |
| ✓ | 23 | Playtime（1967） | Jacques Tati | [玩乐时间](https://movie.douban.com/subject/1303543/) | 1967 | movie | 160 |
| ✓ | 24 | Do the Right Thing（1989） | Spike Lee | [为所应为](https://movie.douban.com/subject/1293958/) | 1989 | movie | 160 |
| ✓ | 25 | The Night of the Hunter（1955） | Charles Laughton | [猎人之夜](https://movie.douban.com/subject/1293582/) | 1955 | movie | 160 |
| ✓ | 26 | Au hasard Balthazar（1966） | Robert Bresson | [驴子巴特萨](https://movie.douban.com/subject/1401619/) | 1966 | movie | 160 |
| ✓ | 27 | Shoah（1985） | Claude Lanzmann | [浩劫](https://movie.douban.com/subject/1303328/) | 1985 | movie | 160 |
| ✓ | 28 | Daisies（1966） | Věra Chytilová | [雏菊](https://movie.douban.com/subject/1296500/) | 1966 | movie | 160 |
| ✓ | 29 | Taxi Driver（1976） | Martin Scorsese | [出租车司机](https://movie.douban.com/subject/1292222/) | 1976 | movie | 160 |
| ✓ | 30 | Portrait of a Lady on Fire（2019） | Céline Sciamma | [燃烧女子的肖像](https://movie.douban.com/subject/30257175/) | 2019 | movie | 160 |
| ✓ | 31 | Psycho（1960） | Alfred Hitchcock | [惊魂记](https://movie.douban.com/subject/1293181/) | 1960 | movie | 160 |
| ✓ | 32 | 8½（1963） | Federico Fellini | [八部半](https://movie.douban.com/subject/1361276/) | 1963 | movie | 160 |
| ✓ | 33 | Mirror（1975） | Andrei Tarkovsky | [镜子](https://movie.douban.com/subject/1299248/) | 1975 | movie | 140 |
| ✓ | 34 | L'Atalante（1934） | Jean Vigo | [亚特兰大号](https://movie.douban.com/subject/1299433/) | 1934 | movie | 160 |
| ✓ | 35 | Pather Panchali（1955） | Satyajit Ray | [大地之歌](https://movie.douban.com/subject/1306019/) | 1955 | movie | 160 |
| ✓ | 36 | City Lights（1931） | Charles Chaplin | [城市之光](https://movie.douban.com/subject/1293908/) | 1931 | movie | 160 |
| ? | 37 | M（1931） | Fritz Lang | [M就是凶手](https://movie.douban.com/subject/1297360/) | 1951 | movie | 65 |
| ✓ | 38 | Rear Window（1954） | Alfred Hitchcock | [后窗](https://movie.douban.com/subject/1299080/) | 1954 | movie | 160 |
| ✓ | 39 | Some Like It Hot（1959） | Billy Wilder | [热情如火](https://movie.douban.com/subject/1292574/) | 1959 | movie | 160 |
| ✓ | 40 | À bout de souffle（1960） | Jean-Luc Godard | [精疲力尽](https://movie.douban.com/subject/1353745/) | 1960 | movie | 160 |
| ✓ | 41 | Bicycle Thieves（1948） | Vittorio De Sica | [偷自行车的人](https://movie.douban.com/subject/1295873/) | 1948 | movie | 140 |
| ✓ | 42 | Rashomon（1950） | Akira Kurosawa | [罗生门](https://movie.douban.com/subject/1291879/) | 1950 | movie | 160 |
| ✓ | 43 | Killer of Sheep（1977） | Charles Burnett | [杀羊人](https://movie.douban.com/subject/1303494/) | 1978 | movie | 145 |
| ✓ | 44 | Stalker（1979） | Andrei Tarkovsky | [潜行者](https://movie.douban.com/subject/1295656/) | 1979 | movie | 160 |
| ✓ | 45 | North by Northwest（1959） | Alfred Hitchcock | [西北偏北](https://movie.douban.com/subject/1295872/) | 1959 | movie | 160 |
| ✓ | 46 | The Battle of Algiers（1966） | Gillo Pontecorvo | [阿尔及尔之战](https://movie.douban.com/subject/1419005/) | 1966 | movie | 160 |
| ✓ | 47 | Barry Lyndon（1975） | Stanley Kubrick | [巴里·林登](https://movie.douban.com/subject/1292472/) | 1975 | movie | 160 |
| ✓ | 48 | Ordet（1955） | Carl Th. Dreyer | [词语](https://movie.douban.com/subject/1303566/) | 1955 | movie | 160 |
| ✓ | 49 | Wanda（1970） | Barbara Loden | [旺达](https://movie.douban.com/subject/1855338/) | 1970 | movie | 160 |
| – | 50 | The 400 Blows（1959） | François Truffaut | — |  |  |  |
| – | 51 | The Piano（1992） | Jane Campion | — |  |  |  |
| – | 52 | Fear Eats the Soul（1974） | Rainer Werner Fassbinder | — |  |  |  |
| – | 53 | News from Home（1976） | Chantal Akerman | — |  |  |  |
| – | 54 | Sherlock Jr.（1924） | Buster Keaton | — |  |  |  |
| ✓ | 55 | Battleship Potemkin（1925） | Sergei M. Eisenstein | [战舰波将金号](https://movie.douban.com/subject/1293492/) | 1925 | movie | 160 |
| ✓ | 56 | The Apartment（1960） | Billy Wilder | [桃色公寓](https://movie.douban.com/subject/1394218/) | 1960 | movie | 160 |
| ✓ | 57 | Le Mépris（1963） | Jean-Luc Godard | [蔑视](https://movie.douban.com/subject/1303555/) | 1963 | movie | 160 |
| ✓ | 58 | Blade Runner（1982） | Ridley Scott | [银翼杀手](https://movie.douban.com/subject/1291839/) | 1982 | movie | 160 |
| ✓ | 59 | Sans soleil（1982） | Chris Marker | [日月无光](https://movie.douban.com/subject/1401901/) | 1983 | movie | 145 |
| ✓ | 60 | La dolce vita（1960） | Federico Fellini | [甜蜜的生活](https://movie.douban.com/subject/1293271/) | 1960 | movie | 160 |
| ✓ | 61 | Daughters of the Dust（1991） | Julie Dash | [大地的女儿](https://movie.douban.com/subject/1890283/) | 1991 | movie | 160 |
| ✓ | 62 | Moonlight（2016） | Barry Jenkins | [月光男孩](https://movie.douban.com/subject/26648249/) | 2016 | movie | 160 |
| ✓ | 63 | Casablanca（1942） | Michael Curtiz | [卡萨布兰卡](https://movie.douban.com/subject/1296753/) | 1942 | movie | 160 |
| ✓ | 64 | The Third Man（1949） | Carol Reed | [第三人](https://movie.douban.com/subject/1295451/) | 1949 | movie | 160 |
| – | 65 | GoodFellas（1990） | Martin Scorsese | — |  |  |  |
| – | 66 | Touki Bouki（1973） | Djibril Diop Mambéty | — |  |  |  |
| – | 67 | Metropolis（1927） | Fritz Lang | — |  |  |  |
| – | 68 | The Red Shoes（1948） | Michael Powell, Emeric Pressburger | — |  |  |  |
| – | 69 | La Jetée（1962） | Chris Marker | — |  |  |  |
| – | 70 | Andrei Rublev（1966） | Andrei Tarkovsky | — |  |  |  |
| – | 71 | The Gleaners and I（2000） | Agnès Varda | — |  |  |  |
| – | 72 | Journey to Italy（1954） | Roberto Rossellini | — |  |  |  |
| – | 73 | L'avventura（1960） | Michelangelo Antonioni | — |  |  |  |
| – | 74 | My Neighbour Totoro（1988） | Hayao Miyazaki | — |  |  |  |
| – | 75 | Sansho the Bailiff（1954） | Kenji Mizoguchi | — |  |  |  |
| – | 76 | Imitation of Life（1959） | Douglas Sirk | — |  |  |  |
| – | 77 | Spirited Away（2001） | Hayao Miyazaki | — |  |  |  |
| – | 78 | Modern Times（1936） | Charles Chaplin | — |  |  |  |
| – | 79 | A Matter of Life and Death（1946） | Michael Powell, Emeric Pressburger | — |  |  |  |
| – | 80 | Sunset Blvd.（1950） | Billy Wilder | — |  |  |  |
| – | 81 | Céline and Julie Go Boating（1974） | Jacques Rivette | — |  |  |  |
| – | 82 | Histoire(s) du Cinéma（1988） | Jean-Luc Godard | — |  |  |  |
| – | 83 | A Brighter Summer Day（1991） | Edward Yang | — |  |  |  |
| – | 84 | Sátántangó（1994） | Béla Tarr | — |  |  |  |
| – | 85 | Pierrot le fou（1965） | Jean-Luc Godard | — |  |  |  |
| – | 86 | The Spirit of the Beehive（1973） | Víctor Erice | — |  |  |  |
| – | 87 | Blue Velvet（1986） | David Lynch | — |  |  |  |
| – | 88 | The Shining（1980） | Stanley Kubrick | — |  |  |  |
| – | 89 | Chungking Express（1994） | Wong Kar Wai | — |  |  |  |
| – | 90 | Madame de...（1953） | Max Ophuls | — |  |  |  |
| – | 91 | Ugetsu Monogatari（1953） | Kenji Mizoguchi | — |  |  |  |
| – | 92 | The Leopard（1962） | Luchino Visconti | — |  |  |  |
| – | 93 | Yi Yi（1999） | Edward Yang | — |  |  |  |
| – | 94 | Parasite（2019） | Bong Joon-ho | — |  |  |  |
| – | 95 | The General（1926） | Buster Keaton, Clyde Bruckman | — |  |  |  |
| – | 96 | A Man Escaped（1956） | Robert Bresson | — |  |  |  |
| – | 97 | Black Girl（1965） | Ousmane Sembène | — |  |  |  |
| – | 98 | Once upon a Time in the West（1968） | Sergio Leone | — |  |  |  |
| – | 99 | Tropical Malady（2004） | Apichatpong Weerasethakul | — |  |  |  |
| – | 100 | Get Out（2017） | Jordan Peele | — |  |  |  |
| – | 101 | Rio Bravo（1958） | Howard Hawks | — |  |  |  |
| – | 102 | The House Is Black（1962） | Forough Farokhzad | — |  |  |  |
| – | 103 | Vagabond（1985） | Agnès Varda | — |  |  |  |
| – | 104 | La Maman et la Putain（1973） | Jean Eustache | — |  |  |  |
| – | 105 | The Godfather Part II（1974） | Francis Ford Coppola | — |  |  |  |
| – | 106 | Jaws（1975） | Steven Spielberg | — |  |  |  |
| – | 107 | Come and See（1985） | Elem Klimov | — |  |  |  |
| – | 108 | Bringing Up Baby（1938） | Howard Hawks | — |  |  |  |
| – | 109 | The Wizard of Oz（1939） | Victor Fleming | — |  |  |  |
| – | 110 | Wild Strawberries（1957） | Ingmar Bergman | — |  |  |  |
| – | 111 | Touch of Evil（1958） | Orson Welles | — |  |  |  |
| – | 112 | The Man Who Shot Liberty Valance（1962） | John Ford | — |  |  |  |
| – | 113 | Goodbye, Dragon Inn（2003） | Tsai Ming-liang | — |  |  |  |
| – | 114 | To Be or Not to Be（1942） | Ernst Lubitsch | — |  |  |  |
| – | 115 | Don't Look Now（1973） | Nicolas Roeg | — |  |  |  |
| – | 116 | A Woman under the Influence（1974） | John Cassavetes | — |  |  |  |
| – | 117 | Nashville（1975） | Robert Altman | — |  |  |  |
| – | 118 | The Conformist（1970） | Bernardo Bertolucci | — |  |  |  |
| – | 119 | Aguirre, Wrath of God（1972） | Werner Herzog | — |  |  |  |
| – | 120 | The Texas Chain Saw Massacre（1974） | Tobe Hooper | — |  |  |  |
| – | 121 | The Thing（1982） | John Carpenter | — |  |  |  |
| – | 122 | Only Angels Have Wings（1939） | Howard Hawks | — |  |  |  |
| – | 123 | Johnny Guitar（1954） | Nicholas Ray | — |  |  |  |
| – | 124 | The Umbrellas of Cherbourg（1964） | Jacques Demy | — |  |  |  |
| – | 125 | The Colour of Pomegranates（1968） | Sergei Paradjanov | — |  |  |  |
| – | 126 | The Matrix（1999） | The Wachowskis | — |  |  |  |
| – | 127 | There Will Be Blood（2007） | Paul Thomas Anderson | — |  |  |  |
| – | 128 | The Ascent（1976） | Larissa Shepitko | — |  |  |  |
| – | 129 | His Girl Friday（1939） | Howard Hawks | — |  |  |  |
| – | 130 | Raging Bull（1980） | Martin Scorsese | — |  |  |  |
| – | 131 | Fanny and Alexander（1982） | Ingmar Bergman | — |  |  |  |
| – | 132 | Pulp Fiction（1994） | Quentin Tarantino | — |  |  |  |
| – | 133 | Notorious（1946） | Alfred Hitchcock | — |  |  |  |
| – | 134 | It's a Wonderful Life（1947） | Frank Capra | — |  |  |  |
| – | 135 | Lawrence of Arabia（1962） | David Lean | — |  |  |  |
| – | 136 | Trouble in Paradise（1932） | Ernst Lubitsch | — |  |  |  |
| – | 137 | Partie de campagne（1936） | Jean Renoir | — |  |  |  |
| – | 138 | Les Enfants du paradis（1945） | Marcel Carné | — |  |  |  |
| – | 139 | All That Heaven Allows（1955） | Douglas Sirk | — |  |  |  |
| – | 140 | The Seventh Seal（1957） | Ingmar Bergman | — |  |  |  |
| – | 141 | Pickpocket（1959） | Robert Bresson | — |  |  |  |
| – | 142 | Gertrud（1964） | Carl Th. Dreyer | — |  |  |  |
| – | 143 | The Wild Bunch（1969） | Sam Peckinpah | — |  |  |  |
| – | 144 | Sambizanga（1972） | Sarah Maldoror | — |  |  |  |
| – | 145 | La ciénaga（2001） | Lucrecia Martel | — |  |  |  |
| – | 146 | Vampyr（1932） | Carl Th. Dreyer | — |  |  |  |
| – | 147 | La Grande Illusion（1937） | Jean Renoir | — |  |  |  |
| – | 148 | Chinatown（1974） | Roman Polanski | — |  |  |  |
| – | 149 | India Song（1975） | Marguerite Duras | — |  |  |  |
| – | 150 | Alien（1979） | Ridley Scott | — |  |  |  |
| – | 151 | The Watermelon Woman（1997） | Cheryl Dunye | — |  |  |  |
| – | 152 | Meghe Dhaka Tara（1960） | Ritwik Ghatak | — |  |  |  |
| – | 153 | Le Bonheur（1965） | Agnès Varda | — |  |  |  |
| – | 154 | Days of Heaven（1978） | Terrence Malick | — |  |  |  |
| – | 155 | West Indies: The Fugitive Slaves of Liberty（1979） | Med Hondo | — |  |  |  |
| – | 156 | Twin Peaks: The Return（2017） | David Lynch | — |  |  |  |
| – | 157 | Out of the Past（1947） | Jacques Tourneur | — |  |  |  |
| – | 158 | Los olvidados（1950） | Luis Buñuel | — |  |  |  |
| – | 159 | Ikiru（1952） | Akira Kurosawa | — |  |  |  |
| – | 160 | Vivre sa vie（1962） | Jean-Luc Godard | — |  |  |  |
| – | 161 | The Gospel According to St. Matthew（1964） | Pier Paolo Pasolini | — |  |  |  |
| – | 162 | Amarcord（1972） | Federico Fellini | — |  |  |  |
| – | 163 | Once upon a Time in America（1983） | Sergio Leone | — |  |  |  |
| – | 164 | Where Is the Friend's House?（1987） | Abbas Kiarostami | — |  |  |  |
| – | 165 | A City of Sadness（1989） | Hou Hsiao-Hsien | — |  |  |  |
| – | 166 | Orlando（1992） | Sally Potter | — |  |  |  |
| – | 167 | All about My Mother（1999） | Pedro Almodóvar | — |  |  |  |
| – | 168 | West of the Tracks（2002） | Wang Bing | — |  |  |  |
| – | 169 | Un chien andalou（1928） | Luis Buñuel | — |  |  |  |
| – | 170 | The Magnificent Ambersons（1942） | Orson Welles | — |  |  |  |
| – | 171 | Black Narcissus（1947） | Michael Powell, Emeric Pressburger | — |  |  |  |
| – | 172 | Letter from an Unknown Woman（1948） | Max Ophuls | — |  |  |  |
| – | 173 | Hiroshima mon amour（1959） | Alain Resnais | — |  |  |  |
| – | 174 | Last Year at Marienbad（1961） | Alain Resnais | — |  |  |  |
| – | 175 | The Exterminating Angel（1962） | Luis Buñuel | — |  |  |  |
| – | 176 | Charulata（1964） | Satyajit Ray | — |  |  |  |
| – | 177 | Red Desert（1964） | Michelangelo Antonioni | — |  |  |  |
| – | 178 | The Good, the Bad and the Ugly（1966） | Sergio Leone | — |  |  |  |
| – | 179 | Symbiopsychotaxiplasm: Take One（1967） | William Greaves | — |  |  |  |
| – | 180 | Memories of Underdevelopment（1968） | Tomás Gutiérrez Alea | — |  |  |  |
| – | 181 | L'Argent（1983） | Robert Bresson | — |  |  |  |
| – | 182 | Out 1（1990） | Jacques Rivette | — |  |  |  |
| – | 183 | Heat（1995） | Michael Mann | — |  |  |  |
| – | 184 | Under the Skin（2013） | Jonathan Glazer | — |  |  |  |
| – | 185 | Greed（1923） | Erich von Stroheim | — |  |  |  |
| – | 186 | The River（1951） | Jean Renoir | — |  |  |  |
| – | 187 | Pyaasa（1957） | Guru Dutt | — |  |  |  |
| – | 188 | An Autumn Afternoon（1962） | Yasujirō Ozu | — |  |  |  |
| – | 189 | The Birds（1963） | Alfred Hitchcock | — |  |  |  |
| – | 190 | Les Demoiselles de Rochefort（1967） | Jacques Demy | — |  |  |  |
| – | 191 | Love Streams（1984） | John Cassavetes | — |  |  |  |
| – | 192 | Paris, Texas（1984） | Wim Wenders | — |  |  |  |
| – | 193 | Ran（1985） | Akira Kurosawa | — |  |  |  |
| – | 194 | Wings of Desire（1987） | Wim Wenders | — |  |  |  |
| – | 195 | Magnolia（1999） | Paul Thomas Anderson | — |  |  |  |
| – | 196 | Nosferatu（1922） | F.W. Murnau | — |  |  |  |
| – | 197 | The Life and Death of Colonel Blimp（1943） | Michael Powell, Emeric Pressburger | — |  |  |  |
| – | 198 | Double Indemnity（1944） | Billy Wilder | — |  |  |  |
| – | 199 | I Know Where I’m Going!（1945） | Michael Powell, Emeric Pressburger | — |  |  |  |
| – | 200 | Paisan（1946） | Roberto Rossellini | — |  |  |  |
| – | 201 | L' eclisse（1962） | Michelangelo Antonioni | — |  |  |  |
| – | 202 | Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb（1963） | Stanley Kubrick | — |  |  |  |
| – | 203 | Wavelength（1967） | Michael Snow | — |  |  |  |
| – | 204 | One Way or Another（1977） | Sara Gómez | — |  |  |  |
| – | 205 | Paris Is Burning（1990） | Jennie Livingston | — |  |  |  |
| – | 206 | The Headless Woman（2008） | Lucrecia Martel | — |  |  |  |
| – | 207 | The Tree of Life（2010） | Terrence Malick | — |  |  |  |
| – | 208 | Uncle Boonmee Who Can Recall His Past Lives（2010） | Apichatpong Weerasethakul | — |  |  |  |
| – | 209 | Mad Max: Fury Road（2015） | George Miller | — |  |  |  |
| – | 210 | Zama（2017） | Lucrecia Martel | — |  |  |  |
| – | 211 | Limite（1931） | Mário Peixoto | — |  |  |  |
| – | 212 | Duck Soup（1933） | Leo McCarey | — |  |  |  |
| – | 213 | By the Bluest of Seas（1935） | Boris Barnet | — |  |  |  |
| – | 214 | Brief Encounter（1945） | David Lean | — |  |  |  |
| – | 215 | All about Eve（1950） | Joseph L. Mankiewicz | — |  |  |  |
| – | 216 | In a Lonely Place（1950） | Nicholas Ray | — |  |  |  |
| – | 217 | Army of Shadows（1969） | Jean-Pierre Melville | — |  |  |  |
| – | 218 | Pink Flamingos（1972） | John Waters | — |  |  |  |
| – | 219 | Suspiria（1977） | Dario Argento | — |  |  |  |
| – | 220 | The Deer Hunter（1978） | Michael Cimino | — |  |  |  |
| – | 221 | Raiders of the Lost Ark（1981） | Steven Spielberg | — |  |  |  |
| – | 222 | Twenty Years Later（1984） | Eduardo Coutinho | — |  |  |  |
| – | 223 | Twin Peaks: Fire Walk with Me（1992） | David Lynch | — |  |  |  |
| – | 224 | Melancholia（2011） | Lars von Trier | — |  |  |  |
| – | 225 | Intolerance（1916） | D.W. Griffith | — |  |  |  |
| – | 226 | Napoléon（1927） | Abel Gance | — |  |  |  |
| – | 227 | The Crowd（1928） | King Vidor | — |  |  |  |
| – | 228 | Europa '51（1952） | Roberto Rossellini | — |  |  |  |
| – | 229 | The Hour of the Furnaces（1968） | Fernando Solanas | — |  |  |  |
| – | 230 | A Touch of Zen（1969） | King Hu | — |  |  |  |
| – | 231 | Cries and Whispers（1972） | Ingmar Bergman | — |  |  |  |
| – | 232 | Je, tu, il, elle（1974） | Chantal Akerman | — |  |  |  |
| – | 233 | Harlan County, USA（1976） | Barbara Kopple | — |  |  |  |
| – | 234 | Star Wars（1977） | George Lucas | — |  |  |  |
| – | 235 | The Green Ray（1986） | Eric Rohmer | — |  |  |  |
| – | 236 | Grave of the Fireflies（1988） | Isao Takahata | — |  |  |  |
| – | 237 | Blue（1993） | Derek Jarman | — |  |  |  |
| – | 238 | Crash（1996） | David Cronenberg | — |  |  |  |
| – | 239 | Happy Together（1997） | Wong Kar Wai | — |  |  |  |
| – | 240 | Flowers of Shanghai（1998） | Hou Hsiao-Hsien | — |  |  |  |
| – | 241 | As I Was Moving Ahead, Occasionally I Saw Brief Glimpses of Beauty（2000） | Jonas Mekas | — |  |  |  |
| – | 242 | Petite maman（2021） | Céline Sciamma | — |  |  |  |
| – | 243 | The Last Laugh（1924） | F.W. Murnau | — |  |  |  |
| – | 244 | Pandora's Box（1928） | G.W. Pabst | — |  |  |  |
| – | 245 | Earth（1930） | Alexander Dovzhenko | — |  |  |  |
| – | 246 | Sullivan's Travels（1941） | Preston Sturges | — |  |  |  |
| – | 247 | A Canterbury Tale（1944） | Michael Powell, Emeric Pressburger | — |  |  |  |
| – | 248 | My Darling Clementine（1946） | John Ford | — |  |  |  |
| – | 249 | Mouchette（1966） | Robert Bresson | — |  |  |  |
| – | 250 | Soleil Ô（1970） | Med Hondo | — |  |  |  |
| – | 251 | A Clockwork Orange（1971） | Stanley Kubrick | — |  |  |  |
| – | 252 | Annie Hall（1977） | Woody Allen | — |  |  |  |
| – | 253 | Possession（1981） | Andrzej Zulawski | — |  |  |  |
| – | 254 | Born in Flames（1983） | Lizzie Borden | — |  |  |  |
| – | 255 | Videodrome（1983） | David Cronenberg | — |  |  |  |
| – | 256 | Distant Voices, Still Lives（1988） | Terence Davies | — |  |  |  |
| – | 257 | The Quince Tree Sun（1992） | Víctor Erice | — |  |  |  |
| – | 258 | Taste of Cherry（1997） | Abbas Kiarostami | — |  |  |  |
| – | 259 | In Vanda's Room（2000） | Pedro Costa | — |  |  |  |
| – | 260 | Werckmeister Harmonies（2000） | Béla Tarr | — |  |  |  |
| – | 261 | Morvern Callar（2001） | Lynne Ramsay | — |  |  |  |
| – | 262 | The Intruder（2004） | Claire Denis | — |  |  |  |
| – | 263 | Syndromes and a Century（2006） | Apichatpong Weerasethakul | — |  |  |  |
| – | 264 | Nostalgia for the Light（2010） | Patricio Guzmán | — |  |  |  |
