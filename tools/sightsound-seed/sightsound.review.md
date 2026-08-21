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
| ✓ | 50 | The 400 Blows（1959） | François Truffaut | [四百击](https://movie.douban.com/subject/1300056/) | 1959 | movie | 160 |
| ✓ | 51 | The Piano（1992） | Jane Campion | [钢琴课](https://movie.douban.com/subject/1293818/) | 1993 | movie | 145 |
| ? | 52 | Fear Eats the Soul（1974） | Rainer Werner Fassbinder | [恐惧吞噬灵魂](https://movie.douban.com/subject/1294092/) | 1974 | movie | 60 |
| ✓ | 53 | News from Home（1976） | Chantal Akerman | [家乡的消息](https://movie.douban.com/subject/1902009/) | 1976 | movie | 160 |
| ✓ | 54 | Sherlock Jr.（1924） | Buster Keaton | [福尔摩斯二世](https://movie.douban.com/subject/1303408/) | 1924 | movie | 160 |
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
| ✓ | 65 | GoodFellas（1990） | Martin Scorsese | [好家伙](https://movie.douban.com/subject/1292268/) | 1990 | movie | 160 |
| ✓ | 66 | Touki Bouki（1973） | Djibril Diop Mambéty | [土狼之旅](https://movie.douban.com/subject/1424576/) | 1973 | movie | 160 |
| ✓ | 67 | Metropolis（1927） | Fritz Lang | [大都会](https://movie.douban.com/subject/1298107/) | 1927 | movie | 160 |
| ✓ | 68 | The Red Shoes（1948） | Michael Powell, Emeric Pressburger | [红菱艳](https://movie.douban.com/subject/1299204/) | 1948 | movie | 160 |
| ✓ | 69 | La Jetée（1962） | Chris Marker | [堤](https://movie.douban.com/subject/1306626/) | 1962 | movie | 160 |
| ✓ | 70 | Andrei Rublev（1966） | Andrei Tarkovsky | [安德烈·卢布廖夫](https://movie.douban.com/subject/1298248/) | 1966 | movie | 160 |
| ? | 71 | The Gleaners and I（2000） | Agnès Varda | [拾穗者](https://movie.douban.com/subject/1301279/) | 2000 | movie | 60 |
| ✓ | 72 | Journey to Italy（1954） | Roberto Rossellini | [游览意大利](https://movie.douban.com/subject/1303576/) | 1954 | movie | 160 |
| ✓ | 73 | L'avventura（1960） | Michelangelo Antonioni | [奇遇](https://movie.douban.com/subject/1389923/) | 1960 | movie | 160 |
| ? | 74 | My Neighbour Totoro（1988） | Hayao Miyazaki | [龙猫](https://movie.douban.com/subject/1291560/) | 1988 | movie | 60 |
| ✓ | 75 | Sansho the Bailiff（1954） | Kenji Mizoguchi | [山椒大夫](https://movie.douban.com/subject/1303573/) | 1954 | movie | 160 |
| ✓ | 76 | Imitation of Life（1959） | Douglas Sirk | [春风秋雨](https://movie.douban.com/subject/1294625/) | 1959 | movie | 160 |
| ✓ | 77 | Spirited Away（2001） | Hayao Miyazaki | [千与千寻](https://movie.douban.com/subject/1291561/) | 2001 | movie | 160 |
| ✓ | 78 | Modern Times（1936） | Charles Chaplin | [摩登时代](https://movie.douban.com/subject/1294371/) | 1936 | movie | 160 |
| ✓ | 79 | A Matter of Life and Death（1946） | Michael Powell, Emeric Pressburger | [平步青云](https://movie.douban.com/subject/1299411/) | 1946 | movie | 160 |
| ✓ | 80 | Sunset Blvd.（1950） | Billy Wilder | [日落大道](https://movie.douban.com/subject/1298733/) | 1950 | movie | 160 |
| ? | 81 | Céline and Julie Go Boating（1974） | Jacques Rivette | [塞琳和朱莉出航记](https://movie.douban.com/subject/1418141/) | 1974 | movie | 60 |
| ? | 82 | Histoire(s) du Cinéma（1988） | Jean-Luc Godard | [电影史-1A 所有的历史](https://movie.douban.com/subject/1439723/) | 1989 | movie | 45 |
| ✓ | 83 | A Brighter Summer Day（1991） | Edward Yang | [牯岭街少年杀人事件](https://movie.douban.com/subject/1292329/) | 1991 | movie | 160 |
| ✓ | 84 | Sátántangó（1994） | Béla Tarr | [撒旦探戈](https://movie.douban.com/subject/1422088/) | 1994 | movie | 160 |
| ✓ | 85 | Pierrot le fou（1965） | Jean-Luc Godard | [狂人皮埃罗](https://movie.douban.com/subject/1292533/) | 1965 | movie | 160 |
| ✓ | 86 | The Spirit of the Beehive（1973） | Víctor Erice | [蜂巢幽灵](https://movie.douban.com/subject/1401900/) | 1973 | movie | 160 |
| ✓ | 87 | The Shining（1980） | Stanley Kubrick | [闪灵](https://movie.douban.com/subject/1292225/) | 1980 | movie | 160 |
| ✓ | 88 | Chungking Express（1994） | Wong Kar Wai | [重庆森林](https://movie.douban.com/subject/1291999/) | 1994 | movie | 160 |
| ✓ | 89 | Madame de...（1953） | Max Ophuls | [伯爵夫人的耳环](https://movie.douban.com/subject/1301122/) | 1953 | movie | 160 |
| ✓ | 90 | Ugetsu Monogatari（1953） | Kenji Mizoguchi | [雨月物语](https://movie.douban.com/subject/1303577/) | 1953 | movie | 160 |
| ✓ | 91 | The Leopard（1962） | Luchino Visconti | [豹](https://movie.douban.com/subject/1293146/) | 1963 | movie | 145 |
| ✓ | 92 | Yi Yi（1999） | Edward Yang | [一一](https://movie.douban.com/subject/1292434/) | 2000 | movie | 145 |
| ✓ | 93 | Parasite（2019） | Bong Joon-ho | [寄生虫](https://movie.douban.com/subject/27010768/) | 2019 | movie | 160 |
| ✓ | 94 | The General（1926） | Buster Keaton, Clyde Bruckman | [将军号](https://movie.douban.com/subject/1292778/) | 1926 | movie | 160 |
| ✓ | 95 | A Man Escaped（1956） | Robert Bresson | [死囚越狱](https://movie.douban.com/subject/1303562/) | 1956 | movie | 160 |
| ✓ | 96 | Black Girl（1965） | Ousmane Sembène | [黑女孩](https://movie.douban.com/subject/2060678/) | 1966 | movie | 145 |
| ✓ | 97 | Once upon a Time in the West（1968） | Sergio Leone | [西部往事](https://movie.douban.com/subject/1293394/) | 1968 | movie | 160 |
| ✓ | 98 | Tropical Malady（2004） | Apichatpong Weerasethakul | [热带疾病](https://movie.douban.com/subject/1414808/) | 2004 | movie | 160 |
| ✓ | 99 | Get Out（2017） | Jordan Peele | [逃出绝命镇](https://movie.douban.com/subject/26688480/) | 2017 | movie | 160 |
| ✓ | 100 | Rio Bravo（1958） | Howard Hawks | [赤胆屠龙](https://movie.douban.com/subject/1298497/) | 1959 | movie | 145 |
| ✓ | 101 | The House Is Black（1962） | Forough Farokhzad | [房屋是黑的](https://movie.douban.com/subject/1499492/) | 1963 | movie | 145 |
| ✓ | 102 | Vagabond（1985） | Agnès Varda | [天涯沦落女](https://movie.douban.com/subject/1292445/) | 1985 | movie | 160 |
| ✓ | 103 | La Maman et la Putain（1973） | Jean Eustache | [母亲与娼妓](https://movie.douban.com/subject/1295252/) | 1973 | movie | 160 |
| ✓ | 104 | The Godfather Part II（1974） | Francis Ford Coppola | [教父2](https://movie.douban.com/subject/1299131/) | 1974 | movie | 160 |
| ✓ | 105 | Jaws（1975） | Steven Spielberg | [大白鲨](https://movie.douban.com/subject/1294941/) | 1975 | movie | 160 |
| ✓ | 106 | Come and See（1985） | Elem Klimov | [自己去看](https://movie.douban.com/subject/1422186/) | 1985 | movie | 160 |
| ✓ | 107 | Bringing Up Baby（1938） | Howard Hawks | [育婴奇谭](https://movie.douban.com/subject/1297657/) | 1938 | movie | 160 |
| ✓ | 108 | The Wizard of Oz（1939） | Victor Fleming | [绿野仙踪](https://movie.douban.com/subject/1292625/) | 1939 | movie | 160 |
| ✓ | 109 | Wild Strawberries（1957） | Ingmar Bergman | [野草莓](https://movie.douban.com/subject/1293071/) | 1957 | movie | 160 |
| ✓ | 110 | Touch of Evil（1958） | Orson Welles | [历劫佳人](https://movie.douban.com/subject/1294756/) | 1958 | movie | 160 |
| ✓ | 111 | The Man Who Shot Liberty Valance（1962） | John Ford | [双虎屠龙](https://movie.douban.com/subject/1295134/) | 1962 | movie | 160 |
| ✓ | 112 | Goodbye, Dragon Inn（2003） | Tsai Ming-liang | [不散](https://movie.douban.com/subject/1304862/) | 2003 | movie | 160 |
| ✓ | 113 | To Be or Not to Be（1942） | Ernst Lubitsch | [你逃我也逃](https://movie.douban.com/subject/1303418/) | 1942 | movie | 160 |
| ✓ | 114 | Don't Look Now（1973） | Nicolas Roeg | [威尼斯疑魂](https://movie.douban.com/subject/1302294/) | 1973 | movie | 160 |
| ✓ | 115 | A Woman under the Influence（1974） | John Cassavetes | [醉酒的女人](https://movie.douban.com/subject/1293525/) | 1974 | movie | 160 |
| ✓ | 116 | Nashville（1975） | Robert Altman | [纳什维尔](https://movie.douban.com/subject/1293037/) | 1975 | movie | 160 |
| ✓ | 117 | The Conformist（1970） | Bernardo Bertolucci | [同流者](https://movie.douban.com/subject/1300955/) | 1970 | movie | 160 |
| ? | 118 | Aguirre, Wrath of God（1972） | Werner Herzog | [阿基尔，上帝的愤怒](https://movie.douban.com/subject/1306002/) | 1972 | movie | 60 |
| ✓ | 119 | The Texas Chain Saw Massacre（1974） | Tobe Hooper | [德州电锯杀人狂](https://movie.douban.com/subject/1300392/) | 1974 | movie | 160 |
| ✓ | 120 | The Thing（1982） | John Carpenter | [怪形](https://movie.douban.com/subject/1296794/) | 1982 | movie | 160 |
| ✓ | 121 | Only Angels Have Wings（1939） | Howard Hawks | [天使之翼](https://movie.douban.com/subject/1300712/) | 1939 | movie | 160 |
| ✓ | 122 | Johnny Guitar（1954） | Nicholas Ray | [荒漠怪客](https://movie.douban.com/subject/1303575/) | 1954 | movie | 160 |
| ✓ | 123 | The Umbrellas of Cherbourg（1964） | Jacques Demy | [瑟堡的雨伞](https://movie.douban.com/subject/1301646/) | 1964 | movie | 160 |
| ? | 124 | The Colour of Pomegranates（1968） | Sergei Paradjanov | [石榴的颜色](https://movie.douban.com/subject/1303542/) | 1969 | movie | 45 |
| ✓ | 125 | The Matrix（1999） | The Wachowskis | [黑客帝国](https://movie.douban.com/subject/1291843/) | 1999 | movie | 160 |
| ✓ | 126 | There Will Be Blood（2007） | Paul Thomas Anderson | [血色将至](https://movie.douban.com/subject/1945780/) | 2007 | movie | 160 |
| ✓ | 127 | The Ascent（1976） | Larissa Shepitko | [上升](https://movie.douban.com/subject/1303255/) | 1977 | movie | 145 |
| ✓ | 128 | His Girl Friday（1939） | Howard Hawks | [女友礼拜五](https://movie.douban.com/subject/1299231/) | 1940 | movie | 145 |
| ✓ | 129 | Raging Bull（1980） | Martin Scorsese | [愤怒的公牛](https://movie.douban.com/subject/1293155/) | 1980 | movie | 160 |
| ✓ | 130 | Fanny and Alexander（1982） | Ingmar Bergman | [芬妮与亚历山大](https://movie.douban.com/subject/1292784/) | 1982 | movie | 160 |
| ✓ | 131 | Pulp Fiction（1994） | Quentin Tarantino | [低俗小说](https://movie.douban.com/subject/1291832/) | 1994 | movie | 160 |
| ✓ | 132 | Notorious（1946） | Alfred Hitchcock | [美人计](https://movie.douban.com/subject/1300766/) | 1946 | movie | 160 |
| ✓ | 133 | It's a Wonderful Life（1947） | Frank Capra | [生活多美好](https://movie.douban.com/subject/1293749/) | 1946 | movie | 145 |
| ✓ | 134 | Lawrence of Arabia（1962） | David Lean | [阿拉伯的劳伦斯](https://movie.douban.com/subject/1292349/) | 1962 | movie | 160 |
| ✓ | 135 | Trouble in Paradise（1932） | Ernst Lubitsch | [天堂里的烦恼](https://movie.douban.com/subject/1294746/) | 1932 | movie | 160 |
| ? | 136 | Partie de campagne（1936） | Jean Renoir | [乡间一日](https://movie.douban.com/subject/1401585/) | 1946 | movie | 65 |
| ✓ | 137 | Les Enfants du paradis（1945） | Marcel Carné | [天堂的孩子](https://movie.douban.com/subject/1300375/) | 1945 | movie | 160 |
| ✓ | 138 | All That Heaven Allows（1955） | Douglas Sirk | [深锁春光一院愁](https://movie.douban.com/subject/1303345/) | 1955 | movie | 160 |
| ✓ | 139 | The Seventh Seal（1957） | Ingmar Bergman | [第七封印](https://movie.douban.com/subject/1293234/) | 1957 | movie | 160 |
| ✓ | 140 | Pickpocket（1959） | Robert Bresson | [扒手](https://movie.douban.com/subject/1303559/) | 1959 | movie | 160 |
| ✓ | 141 | Gertrud（1964） | Carl Th. Dreyer | [葛楚](https://movie.douban.com/subject/1420116/) | 1964 | movie | 160 |
| ✓ | 142 | The Wild Bunch（1969） | Sam Peckinpah | [日落黄沙](https://movie.douban.com/subject/1296963/) | 1969 | movie | 160 |
| ✓ | 143 | Sambizanga（1972） | Sarah Maldoror | [桑比赞加](https://movie.douban.com/subject/4729942/) | 1973 | movie | 145 |
| ✓ | 144 | La ciénaga（2001） | Lucrecia Martel | [沼泽](https://movie.douban.com/subject/1420225/) | 2001 | movie | 160 |
| ✓ | 145 | Vampyr（1932） | Carl Th. Dreyer | [吸血鬼](https://movie.douban.com/subject/1300749/) | 1932 | movie | 160 |
| ✓ | 146 | La Grande Illusion（1937） | Jean Renoir | [大幻影](https://movie.douban.com/subject/1294808/) | 1937 | movie | 160 |
| ✓ | 147 | Chinatown（1974） | Roman Polanski | [唐人街](https://movie.douban.com/subject/1293889/) | 1974 | movie | 160 |
| ✓ | 148 | India Song（1975） | Marguerite Duras | [印度之歌](https://movie.douban.com/subject/1298347/) | 1975 | movie | 160 |
| – | 149 | Alien（1979） | Ridley Scott | — |  |  |  |
| – | 150 | The Watermelon Woman（1997） | Cheryl Dunye | — |  |  |  |
| – | 151 | Meghe Dhaka Tara（1960） | Ritwik Ghatak | — |  |  |  |
| – | 152 | Le Bonheur（1965） | Agnès Varda | — |  |  |  |
| ✓ | 153 | Days of Heaven（1978） | Terrence Malick | [天堂之日](https://movie.douban.com/subject/1293232/) | 1978 | movie | 160 |
| ✓ | 154 | Out of the Past（1947） | Jacques Tourneur | [漩涡之外](https://movie.douban.com/subject/1302338/) | 1947 | movie | 160 |
| ✓ | 155 | Los olvidados（1950） | Luis Buñuel | [被遗忘的人们](https://movie.douban.com/subject/1303579/) | 1950 | movie | 160 |
| ✓ | 156 | Ikiru（1952） | Akira Kurosawa | [生之欲](https://movie.douban.com/subject/1293847/) | 1952 | movie | 160 |
| ? | 157 | Vivre sa vie（1962） | Jean-Luc Godard | [随心所欲](https://movie.douban.com/subject/1296757/) | 1962 | movie | 60 |
| – | 158 | The Gospel According to St. Matthew（1964） | Pier Paolo Pasolini | — |  |  |  |
| – | 159 | Amarcord（1972） | Federico Fellini | — |  |  |  |
| – | 160 | Once upon a Time in America（1983） | Sergio Leone | — |  |  |  |
| – | 161 | Where Is the Friend's House?（1987） | Abbas Kiarostami | — |  |  |  |
| – | 162 | A City of Sadness（1989） | Hou Hsiao-Hsien | — |  |  |  |
| – | 163 | Orlando（1992） | Sally Potter | — |  |  |  |
| – | 164 | All about My Mother（1999） | Pedro Almodóvar | — |  |  |  |
| – | 165 | Un chien andalou（1928） | Luis Buñuel | — |  |  |  |
| – | 166 | The Magnificent Ambersons（1942） | Orson Welles | — |  |  |  |
| – | 167 | Black Narcissus（1947） | Michael Powell, Emeric Pressburger | — |  |  |  |
| – | 168 | Letter from an Unknown Woman（1948） | Max Ophuls | — |  |  |  |
| – | 169 | Hiroshima mon amour（1959） | Alain Resnais | — |  |  |  |
| – | 170 | Last Year at Marienbad（1961） | Alain Resnais | — |  |  |  |
| – | 171 | The Exterminating Angel（1962） | Luis Buñuel | — |  |  |  |
| – | 172 | Charulata（1964） | Satyajit Ray | — |  |  |  |
| – | 173 | Red Desert（1964） | Michelangelo Antonioni | — |  |  |  |
| – | 174 | The Good, the Bad and the Ugly（1966） | Sergio Leone | — |  |  |  |
| – | 175 | Symbiopsychotaxiplasm: Take One（1967） | William Greaves | — |  |  |  |
| – | 176 | Memories of Underdevelopment（1968） | Tomás Gutiérrez Alea | — |  |  |  |
| – | 177 | L'Argent（1983） | Robert Bresson | — |  |  |  |
| – | 178 | Out 1（1990） | Jacques Rivette | — |  |  |  |
| – | 179 | Heat（1995） | Michael Mann | — |  |  |  |
| – | 180 | Under the Skin（2013） | Jonathan Glazer | — |  |  |  |
| – | 181 | Greed（1923） | Erich von Stroheim | — |  |  |  |
| – | 182 | The River（1951） | Jean Renoir | — |  |  |  |
| – | 183 | Pyaasa（1957） | Guru Dutt | — |  |  |  |
| – | 184 | An Autumn Afternoon（1962） | Yasujirō Ozu | — |  |  |  |
| – | 185 | The Birds（1963） | Alfred Hitchcock | — |  |  |  |
| – | 186 | Les Demoiselles de Rochefort（1967） | Jacques Demy | — |  |  |  |
| – | 187 | Love Streams（1984） | John Cassavetes | — |  |  |  |
| – | 188 | Paris, Texas（1984） | Wim Wenders | — |  |  |  |
| – | 189 | Ran（1985） | Akira Kurosawa | — |  |  |  |
| – | 190 | Wings of Desire（1987） | Wim Wenders | — |  |  |  |
| – | 191 | Magnolia（1999） | Paul Thomas Anderson | — |  |  |  |
| – | 192 | Nosferatu（1922） | F.W. Murnau | — |  |  |  |
| – | 193 | The Life and Death of Colonel Blimp（1943） | Michael Powell, Emeric Pressburger | — |  |  |  |
| – | 194 | Double Indemnity（1944） | Billy Wilder | — |  |  |  |
| – | 195 | I Know Where I’m Going!（1945） | Michael Powell, Emeric Pressburger | — |  |  |  |
| – | 196 | Paisan（1946） | Roberto Rossellini | — |  |  |  |
| – | 197 | L' eclisse（1962） | Michelangelo Antonioni | — |  |  |  |
| – | 198 | Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb（1963） | Stanley Kubrick | — |  |  |  |
| – | 199 | Wavelength（1967） | Michael Snow | — |  |  |  |
| – | 200 | One Way or Another（1977） | Sara Gómez | — |  |  |  |
| – | 201 | Paris Is Burning（1990） | Jennie Livingston | — |  |  |  |
| – | 202 | The Headless Woman（2008） | Lucrecia Martel | — |  |  |  |
| – | 203 | The Tree of Life（2010） | Terrence Malick | — |  |  |  |
| – | 204 | Uncle Boonmee Who Can Recall His Past Lives（2010） | Apichatpong Weerasethakul | — |  |  |  |
| – | 205 | Mad Max: Fury Road（2015） | George Miller | — |  |  |  |
| – | 206 | Zama（2017） | Lucrecia Martel | — |  |  |  |
| – | 207 | Limite（1931） | Mário Peixoto | — |  |  |  |
| – | 208 | Duck Soup（1933） | Leo McCarey | — |  |  |  |
| – | 209 | By the Bluest of Seas（1935） | Boris Barnet | — |  |  |  |
| – | 210 | Brief Encounter（1945） | David Lean | — |  |  |  |
| – | 211 | All about Eve（1950） | Joseph L. Mankiewicz | — |  |  |  |
| – | 212 | In a Lonely Place（1950） | Nicholas Ray | — |  |  |  |
| – | 213 | Army of Shadows（1969） | Jean-Pierre Melville | — |  |  |  |
| – | 214 | Suspiria（1977） | Dario Argento | — |  |  |  |
| – | 215 | The Deer Hunter（1978） | Michael Cimino | — |  |  |  |
| – | 216 | Raiders of the Lost Ark（1981） | Steven Spielberg | — |  |  |  |
| – | 217 | Twin Peaks: Fire Walk with Me（1992） | David Lynch | — |  |  |  |
| – | 218 | Melancholia（2011） | Lars von Trier | — |  |  |  |
| – | 219 | Intolerance（1916） | D.W. Griffith | — |  |  |  |
| – | 220 | Napoléon（1927） | Abel Gance | — |  |  |  |
| – | 221 | The Crowd（1928） | King Vidor | — |  |  |  |
| – | 222 | Europa '51（1952） | Roberto Rossellini | — |  |  |  |
| – | 223 | The Hour of the Furnaces（1968） | Fernando Solanas | — |  |  |  |
| – | 224 | A Touch of Zen（1969） | King Hu | — |  |  |  |
| – | 225 | Cries and Whispers（1972） | Ingmar Bergman | — |  |  |  |
| – | 226 | Je, tu, il, elle（1974） | Chantal Akerman | — |  |  |  |
| – | 227 | Harlan County, USA（1976） | Barbara Kopple | — |  |  |  |
| – | 228 | Star Wars（1977） | George Lucas | — |  |  |  |
| – | 229 | The Green Ray（1986） | Eric Rohmer | — |  |  |  |
| – | 230 | Grave of the Fireflies（1988） | Isao Takahata | — |  |  |  |
| – | 231 | Crash（1996） | David Cronenberg | — |  |  |  |
| – | 232 | Happy Together（1997） | Wong Kar Wai | — |  |  |  |
| – | 233 | Flowers of Shanghai（1998） | Hou Hsiao-Hsien | — |  |  |  |
| – | 234 | As I Was Moving Ahead, Occasionally I Saw Brief Glimpses of Beauty（2000） | Jonas Mekas | — |  |  |  |
| – | 235 | Petite maman（2021） | Céline Sciamma | — |  |  |  |
| – | 236 | The Last Laugh（1924） | F.W. Murnau | — |  |  |  |
| – | 237 | Pandora's Box（1928） | G.W. Pabst | — |  |  |  |
| – | 238 | Earth（1930） | Alexander Dovzhenko | — |  |  |  |
| – | 239 | Sullivan's Travels（1941） | Preston Sturges | — |  |  |  |
| – | 240 | A Canterbury Tale（1944） | Michael Powell, Emeric Pressburger | — |  |  |  |
| – | 241 | My Darling Clementine（1946） | John Ford | — |  |  |  |
| – | 242 | Mouchette（1966） | Robert Bresson | — |  |  |  |
| – | 243 | Soleil Ô（1970） | Med Hondo | — |  |  |  |
| – | 244 | A Clockwork Orange（1971） | Stanley Kubrick | — |  |  |  |
| – | 245 | Annie Hall（1977） | Woody Allen | — |  |  |  |
| – | 246 | Possession（1981） | Andrzej Zulawski | — |  |  |  |
| – | 247 | Born in Flames（1983） | Lizzie Borden | — |  |  |  |
| – | 248 | Videodrome（1983） | David Cronenberg | — |  |  |  |
| – | 249 | Distant Voices, Still Lives（1988） | Terence Davies | — |  |  |  |
| – | 250 | The Quince Tree Sun（1992） | Víctor Erice | — |  |  |  |
| – | 251 | Taste of Cherry（1997） | Abbas Kiarostami | — |  |  |  |
| – | 252 | In Vanda's Room（2000） | Pedro Costa | — |  |  |  |
| – | 253 | Werckmeister Harmonies（2000） | Béla Tarr | — |  |  |  |
| – | 254 | Morvern Callar（2001） | Lynne Ramsay | — |  |  |  |
| – | 255 | The Intruder（2004） | Claire Denis | — |  |  |  |
| – | 256 | Syndromes and a Century（2006） | Apichatpong Weerasethakul | — |  |  |  |
| – | 257 | Nostalgia for the Light（2010） | Patricio Guzmán | — |  |  |  |
