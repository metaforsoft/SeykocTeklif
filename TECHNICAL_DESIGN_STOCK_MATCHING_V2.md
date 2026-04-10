# Stock Matching V2 Teknik Tasarim

## 1. Amac

Bu tasarimin amaci mevcut stok eslestirme yapisindaki istikrarsizligi gidermek ve sistemi dort ayri katmana ayirmaktir:

- zorunlu kural katmani
- aday bulma katmani
- cekirdek skor katmani
- ogrenme ve rerank katmani

Ana hedef, kullanicinin canli ortamda tanimlayabildigi kesin kurallarin skora birakilmamasi ve sistemin stok tablosu sema degisikliklerinden daha az etkilenmesidir.

## 2. Problem Ozeti

Mevcut yapida su sorunlar vardir:

- instruction bazli tercih ile kesin kural birbirine karismistir
- retrieval, scoring, learning ve rerank birbirinin gorev alanina girmektedir
- stok tablosundaki kolon degisiklikleri sessizce aday havuzunu bozabilmektedir
- session icindeki eski talimatlar sonraki eslesmelere sizabilmektedir
- gecmis ogrenmesi yetersiz baglam ile uygulanmaktadir
- ML katmani, scorer reason string'lerine bagli oldugu icin guvenilir degildir

## 3. Tasarim Ilkeleri

- hard rule ile soft preference asla ayni mekanizmada islenmez
- retrieval yuksek recall icin vardir, erken eleme icin degil
- cekirdek scoring deterministik ve izah edilebilir olmalidir
- canli kurallar veri tabaninda tutulur, versiyonlanir ve aktif/pasif yapilabilir
- ogrenme yalnizca baglamsal olarak benzer orneklerde etki etmelidir
- her eslesme sonucu aciklanabilir olmalidir: hangi kural calisti, hangi aday neden elendi, hangi skorlar eklendi

## 4. Hedef Mimari

Yeni akista her siparis satiri icin pipeline su sekilde calisacaktir:

1. Kaynak cozumleme
2. Canonical satir feature uretimi
3. Hard rule evaluation
4. Candidate retrieval
5. Candidate normalization
6. Core scoring
7. Soft preference scoring
8. Contextual learning boost
9. Optional ML rerank
10. Audit log ve explanation uretimi

## 5. Kavramsal Ayirim

### 5.1 Hard Rules

Kesin kurallardir. Saglanmiyorsa aday elenir.

Ornekler:

- kalinlik 0 ile 8 arasinda ise stok kodu `ALV` ile baslamali
- urun tipi `BORU` ise `erp_cap` dolu olmali
- seri `7075` ise alaÅŸim alani `7075` veya ayni seri grubundan olmali degil, tam `7075` olmali
- temper istenmisse aday temper bilgisi bos olamaz

### 5.2 Soft Preferences

Tercih kurallaridir. Skoru etkiler ama tek basina eleme yapmaz.

Ornekler:

- `APL ile baslayanlari one al`
- `7075 serisini tercih et`
- `ithal olanlari once goster`

### 5.3 Learned Behavior

Gecmis geri bildirimlerden gelen baglamsal bias'tir. Asla hard rule yerine gecmez.

### 5.4 Core Scoring

Sistemin ana karar mantigidir. Aasagidaki deterministic sinyallere dayanir:

- kalinlik
- diger olculer
- seri
- temper
- urun tipi
- stok familyasi
- textual similarity

## 6. Veri Modeli

### 6.1 Canonical Stock Model

ERP view'dan gelen stok verisi once canonical modele donusturulecektir.

Onerilen alanlar:

- `stock_id`
- `stock_code`
- `stock_name`
- `is_active`
- `stock_family`
- `product_type`
- `series`
- `series_group`
- `temper`
- `thickness`
- `width`
- `length`
- `height`
- `diameter`
- `unit`
- `origin`
- `raw_attributes_json`
- `search_text`
- `schema_version`
- `normalized_at`

Not:

- Eslestirme artik dogrudan `stock_master` kolonlarina degil canonical alanlara dayanir.
- ERP kolon isimleri degisse bile mapping katmani guncellenerek sistem korunur.

### 6.2 Canonical Input Model

Siparis satirindan cikarilan alanlar:

- `source_line_id`
- `raw_text`
- `normalized_text`
- `product_type`
- `series`
- `temper`
- `thickness`
- `dim_secondary[]`
- `quantity`
- `header_context`
- `extraction_confidence`
- `extraction_profile_id`

### 6.3 Rule Tables

#### `matching_rule_sets`

- `id`
- `name`
- `scope_type` (`global`, `source_type`, `customer`, `profile`, `manual_session`)
- `scope_value`
- `priority`
- `active`
- `version`
- `created_by`
- `created_at`
- `updated_at`

#### `matching_rules`

- `id`
- `rule_set_id`
- `rule_type` (`hard_filter`, `soft_boost`)
- `target_level` (`input`, `candidate`, `pair`)
- `condition_json`
- `effect_json`
- `stop_on_match`
- `active`
- `description`

#### `matching_rule_audit`

- `id`
- `match_history_id`
- `rule_id`
- `candidate_stock_id`
- `decision` (`passed`, `rejected`, `boosted`, `penalized`)
- `delta_score`
- `reason_text`
- `created_at`

### 6.4 Learning Tables

Yeni ogrenme tablolari baglami daha net tasiyacaktir.

#### `matching_feedback_features`

- `id`
- `match_history_id`
- `source_type`
- `profile_id`
- `instruction_policy_id`
- `product_type`
- `series`
- `temper`
- `thickness_bucket`
- `dim_signature`
- `selected_stock_id`
- `selected_stock_family`
- `selected_prefix`
- `approved`

## 7. Rule Engine Tasarimi

### 7.1 Rule DSL

Kurallar JSON bazli saklanir. Her kural su yapida olur:

```json
{
  "condition": {
    "all": [
      { "field": "input.thickness", "op": ">=", "value": 0 },
      { "field": "input.thickness", "op": "<=", "value": 8 }
    ]
  },
  "effect": {
    "type": "require_prefix",
    "value": "ALV"
  }
}
```

Desteklenecek condition operator'leri:

- `=`
- `!=`
- `>`
- `>=`
- `<`
- `<=`
- `in`
- `not_in`
- `contains`
- `starts_with`
- `exists`
- `between`

Mantiksal bloklar:

- `all`
- `any`
- `not`

### 7.2 Rule Effect Turleri

Hard rule effect:

- `require_prefix`
- `require_stock_family`
- `require_product_type`
- `require_exact_series`
- `require_non_null`
- `reject_prefix`
- `reject_if_below_dimension`
- `reject_if_missing_dimension`

Soft rule effect:

- `boost_prefix`
- `boost_series`
- `boost_temper`
- `boost_origin`
- `boost_stock_family`
- `penalize_prefix`

### 7.3 Calisma Sirasi

Her candidate icin sira asagidaki gibi olacaktir:

1. Global hard rules
2. Scope'a ozel hard rules
3. Candidate elenmediyse core scoring
4. Soft rules
5. Learning boost
6. ML rerank

### 7.4 Hard Rule Ornekleri

#### Ornek 1

Kural:

- `input.thickness between 0 and 8`
- effect: `require_prefix = ALV`

Davranis:

- stock code `ALV` ile baslamayan tum adaylar elenir

#### Ornek 2

Kural:

- `input.product_type = BORU`
- effect: `require_non_null = candidate.diameter`

Davranis:

- cap bilgisi olmayan adaylar elenir

#### Ornek 3

Kural:

- `input.series = 7075`
- effect: `require_exact_series = true`

Davranis:

- `7000` seri grubu yetmez, yalnizca `7075` gecer

## 8. Candidate Retrieval Tasarimi

Retrieval'in gorevi dogru adayi hatirlatmak, erken elemek degildir.

Yeni retrieval prensipleri:

- sadece `is_active = true` zorunlu olacak
- text similarity ile baslangic candidate pool alinacak
- varsa canonical olculerle coarse filtering yapilacak
- `series present` gibi gereksiz hard SQL condition'lar kaldirilacak
- hard rules retrieval'dan sonra pair-level uygulanacak

Onerilen asamalar:

1. text similarity top N
2. dimension-aware text similarity top N
3. optional stock family candidate expansion
4. union distinct candidate pool

Onerilen default havuz:

- boyutlu satirlarda `300-500`
- boyutsuz satirlarda `100-150`

## 9. Core Scoring V2

### 9.1 Structured Feature Output

Skorlayici artik sadece sayi dondurmez. Structured feature object dondurur:

```ts
interface CandidateScoreBreakdown {
  hardRulePass: boolean;
  baseScore: number;
  components: {
    thickness: number;
    dimensions: number;
    series: number;
    temper: number;
    productType: number;
    textSimilarity: number;
    stockFamily: number;
  };
  penalties: string[];
  boosts: string[];
}
```

Bu sayede:

- UI aciklama uretebilir
- ML ayni structured feature set'i kullanir
- debug ve tuning kolaylasir

### 9.2 Scoring Ilkeleri

- kalinlik tek bir canonical kaynaktan puanlanir
- stok kodu ve stok adindan parse edilen degerler sadece fallback veya confidence signal olur
- ayni sinyal uc kez sayilmaz
- exact candidate exists cezasi yalnizca ayni baglam icinde kontrollu uygulanir

### 9.3 Onerilen Agliklar

Baslangic icin:

- thickness: `0-35`
- secondary dims: `0-25`
- series: `0-20`
- temper: `0-12`
- product type: `0-10`
- text similarity: `0-8`
- stock family prior: `0-8`

Hard penalties:

- thickness below requested: reject veya buyuk ceza
- required dimension missing: reject veya buyuk ceza

## 10. Talimat Isleme Tasarimi

Instruction parsing uc tipe ayrilacak:

### 10.1 Extraction Instruction

Dokuman veya excel cozumlemeyi etkiler.

Ornekler:

- `bu dosyada 8 olcu var`
- `X kolonu en, Y kolonu kalinlik, Z kolonu boy`
- `miktar ilk kolonda`

### 10.2 Matching Hard Rule Instruction

Canli kural olarak sisteme alinabilir.

Ornekler:

- `kalinlik 0-8 ise ALV ile baslamali`
- `7075 ise tam 7075 seri olsun`

### 10.3 Matching Soft Instruction

Session bazli veya policy bazli tercih.

Ornekler:

- `APL ile baslayanlari one al`
- `ithal olanlari tercih et`

## 11. Canli Kural Yonetimi

Bu kisim kritik gereksinimdir.

### 11.1 Admin Kullanimi

Kullanici canli ortamda yeni hard rule tanimlayabilir:

- kapsam secebilir
- oncelik secebilir
- aktif/pasif yapabilir
- test edebilir
- dry-run gorebilir

### 11.2 UI Yetkinlikleri

Onerilen admin ekrani:

- kural listesi
- yeni kural ekle
- kural test et
- etki analizi
- versiyon gecmisi

### 11.3 Rule Test Modu

Yeni kural kaydedilmeden once test edilmelidir:

- ornek input secilir
- mevcut top 10 sonuc gorulur
- yeni kural uygulanmis sonuc gorulur
- fark raporu verilir

### 11.4 Rule Conflict Yonetimi

Catismalar priority ile cozulur.

Onerilen oncelik:

1. manual session hard rule
2. customer/profile hard rule
3. global hard rule
4. soft preference
5. learning boost

Ek kural:

- bir hard rule reject verdiyse alt katmanlar calismaz

## 12. Ogrenme Tasarimi

Learning su sekilde sinirlandirilir:

- yalnizca benzer baglam icinde boost verir
- hard rule ile celisemez
- explicit user instruction ile cakisiyorsa boost bastirilir

Baglam anahtari:

- source type
- extraction profile
- instruction policy
- product type
- series
- temper
- thickness bucket
- dimension signature
- stock family

Boost formulunde ust limit olmali:

- max `+8` veya `+10`

Mevcut gibi `+24` seviyesinde baskin boost onerilmez.

## 13. ML Rerank Tasarimi

ML katmani opsiyonel kalmali. Ancak kullanilacaksa basit bir classification modeli degil, kabul gormus bir ranking modeli kullanilmalidir.

Bu sistem icin onerilen model ailesi:

- `Learning to Rank`
- tercih edilen algoritma: `LambdaMART`
- tercih edilen kutuphane: `LightGBMRanker`
- alternatif: `XGBoost rank:pairwise`

Bu tercih su nedenle yapilir:

- stok eslestirme problemi bir `siralamali aday secimi` problemidir
- her input satiri icin birden fazla candidate vardir
- business objective top-1 veya top-K kalitesidir, duz classification accuracy degildir
- LambdaMART arama ve rerank problemlerinde uzun suredir kabul gormus bir yaklasimdir

### 13.1 Modelin Rolü

ML modelinin rolu final karari tek basina vermek degildir.

Model sadece su durumda devrededir:

- hard rules gectikten sonra
- retrieval candidate havuzu olustuktan sonra
- core scoring ve soft preference skorlandiktan sonra

Modelin gorevi:

- yakin adaylar arasinda daha iyi siralama yapmak
- deterministic sistemin ayirt etmekte zorlandigi durumlarda tie-break kalitesini artirmak

Modelin gorevi olmayan seyler:

- hard rule ihlal eden adayi geri getirmek
- retrieval'da elenen adayi geri getirmek
- acik business rule'u override etmek

### 13.2 Model Girdisi

ML structured feature vector kullanir.

Onerilen feature set:

- `base_score`
- `hard_rule_pass_count`
- `soft_rule_boost_total`
- `learning_boost_total`
- `text_similarity`
- `thickness_gap_signed`
- `thickness_gap_abs`
- `thickness_exact_flag`
- `thickness_above_nearest_flag`
- `thickness_below_flag`
- `secondary_dim_gap_sum`
- `secondary_dim_gap_max`
- `secondary_dims_exact_count`
- `secondary_dims_missing_count`
- `series_exact_flag`
- `series_group_flag`
- `temper_exact_flag`
- `product_type_exact_flag`
- `stock_family_match_flag`
- `prefix_match_flag`
- `canonical_dim_match_flag`
- `input_has_temper_flag`
- `candidate_has_temper_flag`
- `input_has_series_flag`
- `candidate_has_series_flag`
- `source_type`
- `profile_id`
- `instruction_policy_id`

Not:

- model input'u scorer reason string'lerinden turetilmez
- scorer ve ML ayni structured feature objesini kullanir
- kategorik alanlar one-hot veya native categorical support ile kullanilir

### 13.3 Query Grouping

Learning to Rank icin her egitim ornegi bir `query group` icinde tutulur.

Bu sistemde query group:

- bir siparis satiri
- veya `match_history_id`

Her query group icinde:

- adaylar feature vector ile temsil edilir
- kullanicinin sectigi aday `positive label` alir
- diger adaylar `negative` veya dusuk relevance label alir

### 13.4 Label Uretimi

Onerilen relevance label yapisi:

- `3`: kullanici secimi, sonradan onayli ve degistirilmemis aday
- `2`: ilk sirada gelmis ve kullanici tarafindan kabul edilmis aday
- `1`: top-K icinde olup manuel secilmis ama belirsiz baglamli aday
- `0`: secilmeyen aday

Ilk surumde daha basit label da kullanilabilir:

- `1`: selected_stock_id
- `0`: digerleri

Ancak ileride graded relevance daha iyi sonuc verir.

### 13.5 Egitim Verisi

Model egitimi icin veri kaynagi:

- `match_history`
- secilen aday
- candidate feature snapshot
- aktif hard rule ve soft rule snapshot
- extraction profile ve instruction policy baglami

Bu nedenle yeni bir snapshot tablosu onerilir:

#### `match_candidate_features`

- `id`
- `match_history_id`
- `stock_id`
- `rank_before_ml`
- `was_selected`
- `feature_json`
- `base_score`
- `final_score`
- `created_at`

Bu tablo sayesinde:

- model training reproducible olur
- feature drift izlenir
- eski match'ler yeniden train edilebilir

### 13.6 Egitim Teknolojisi

Onerilen stack:

- training job: Python
- kutuphane: `lightgbm`
- model artifact: versioned binary
- inference: ayri microservice veya Python worker

Node.js icinden dogrudan tree model train etmek yerine:

- training Python'da yapilir
- inference HTTP veya local process ile cagrilir

Bu daha sagliklidir cunku:

- ranking kutuphaneleri Python ekosisteminde daha olgundur
- offline experimentation kolaydir
- model versiyonlama daha duzgun yapilir

### 13.7 Egitim Stratejisi

Batch training onerilir.

Ilk surum:

- gunluk veya saatlik batch retrain
- minimum veri esigi olmadan model aktif edilmez

Aktivasyon kriteri:

- en az `1000+` onayli query group
- veri dagilimi yeterli olmali
- offline metrikler deterministic baseline'i gecmeli

### 13.8 Offline Degerlendirme

Onerilen metrikler:

- `NDCG@1`
- `NDCG@3`
- `MRR`
- `Top-1 Accuracy`
- `Top-3 Recall`

Ana karar metriği:

- `NDCG@3` ve `Top-1 Accuracy`

Model ancak su durumda canliya alinmali:

- baseline deterministic sistemden anlamli daha iyi ise
- belirli musteri veya profil gruplarinda ciddi regresyon yoksa

### 13.9 Online Rollout

Rollout asamali olmali:

1. shadow mode
2. audit mode
3. low-impact rerank
4. full rerank

#### Shadow mode

- model skor hesaplar ama sonucu etkilemez
- sadece loglanir

#### Audit mode

- model ile deterministic top-1 farklari raporlanir
- kullaniciya gosterilmez

#### Low-impact rerank

- model ancak ilk iki uc aday birbirine yakin ise siralamayi degistirebilir

#### Full rerank

- yeterli guven sonrasi aktif edilir

### 13.10 Guvenlik Kurallari

- ML sonucu top-1'i ancak base skor farki belirli esigin altindaysa degistirebilir
- hard rule reject edilen aday asla geri gelemez
- hard rule pass etmeyen aday score alamaz
- model confidence dusukse deterministic sira korunur
- model fallback'i her zaman mevcut olur

### 13.11 Neden Logistic Regression Degil

Basit logistic regression bu sistem icin yeterli degildir cunku:

- adaylar arasi relatif sira problemini iyi modellemez
- non-linear iliskileri zayif yakalar
- feature interaction'lari sinirlidir
- ranking objective yerine classification objective ile calisir

Bu nedenle mevcut `ml.ts` yaklasimi gecici olmali, kalici cozum olmamalidir.

### 13.12 Onerilen Implementasyon Karari

Ilk kabul edilen model:

- `LightGBMRanker (LambdaMART)`

Alternatif:

- `XGBoost rank:pairwise`

Tercih sirasi:

1. `LightGBMRanker`
2. `XGBoost rank:pairwise`
3. gecici olarak ML kapali deterministic sistem

## 14. API Tasarimi

### 14.1 Match API

Mevcut `/match` genisletilecek.

Request:

```json
{
  "text": "AL 7075 8x100x200",
  "sessionInstruction": "APL ile baslayanlari one al",
  "policyIds": [12, 18],
  "topK": 10
}
```

Response:

```json
{
  "matchHistoryId": 1234,
  "results": [
    {
      "stock_id": 1,
      "score": 87.4,
      "hard_rule_pass": true,
      "rule_hits": [
        "R-10 require_prefix: ALV"
      ],
      "score_breakdown": {
        "thickness": 30,
        "dimensions": 18,
        "series": 20,
        "temper": 8,
        "textSimilarity": 5
      }
    }
  ]
}
```

### 14.2 Rule APIs

- `GET /matching-rules`
- `POST /matching-rules`
- `PUT /matching-rules/:id`
- `POST /matching-rules/:id/activate`
- `POST /matching-rules/:id/deactivate`
- `POST /matching-rules/test`
- `GET /matching-rules/audit/:matchHistoryId`

### 14.3 Policy Ayrimi

Instruction policy ile rule engine ayrilacak.

- instruction policy: extraction veya session preference
- matching rules: canli kalici is kurallari

## 15. UI Tasarimi

Kullanici arayuzu uc farkli baglam gostermelidir:

- aktif extraction talimati
- aktif soft matching tercihi
- aktif hard business rules

Satir detayinda su gorulmeli:

- hangi aday hangi hard rule'dan gecti
- hangi aday hangi rule nedeniyle elendi
- secili adayin score breakdown'i

## 16. Gecis Plani

### Faz 1

- canonical stock layer
- retrieval sadeleştirme
- structured scoring output
- audit alanlari

### Faz 2

- hard rule engine
- admin rule API
- soft preference ayrimi

### Faz 3

- contextual learning revizyonu
- ML feature refactor
- regression benchmark

### Faz 4

- UI explainability
- rule testing ekranlari
- operasyonel dashboard

## 17. Riskler

- canonical mapping ilk basta ek efor ister
- canli kural sistemi yanlis kurallarla fazla eleme yapabilir
- audit ve explainability tablolari buyuyebilir
- UI tarafinda fazla bilgi karmasa yaratabilir

Kontroller:

- rule dry-run
- activation approval
- version rollback
- sampled monitoring

## 18. Basari Kriterleri

Olculmesi gereken metrikler:

- top-1 accuracy
- top-3 recall
- manual duzeltme orani
- hard rule nedeniyle elenen aday sayisi
- schema degisikligi sonrasi regresyon sayisi
- instruction sonrasi iyilesme veya bozulma orani

## 19. Acik Kararlar

Karar verilmesi gereken bazi noktalar:

- hard rule tanimi sadece admin rolune mi acik olacak
- customer bazli kurallar gerekecek mi
- session rule'lari otomatik kaydedilecek mi
- ML ilk surumde aktif olacak mi, pasif mi kalacak

## 20. Onerilen Ilk Implementasyon Karari

Ilk uygulamada sunu oneriyorum:

- ML davranisini buyutmeden once kapali veya dusuk etkili tut
- retrieval'daki `series present` zorlamasini kaldir
- hard rule engine'i once sadece 5 effect ile baslat
- mevcut instruction policy sistemini soft preference ve extraction policy olarak daralt
- canonical stock feature tablosunu yeni bir tablo olarak ekle, mevcut sistemi bir anda degistirme

## 21. Sonuc

Bu tasarimla sistem uc net hatta ayrilmis olur:

- is kurallari
- algoritmik eslestirme
- istatistiksel ogrenme

Canlida sonradan tanimlanan kesin kurallar deterministic sekilde uygulanir. Boylece `kalinlik 0-8 ise su prefix` gibi gereksinimler skor oyununa donusmeden garanti altina alinir.

## 22. Uygulama Plani

Bu bolum tasarimi dogrudan uygulama backlog'una cevirir.

### 22.1 Hedef MVP

Ilk MVP'de su kapsam yapilacaktir:

- canonical candidate feature objesi
- retrieval sadeleştirme
- hard rule engine v1
- soft preference ayrimi
- audit log
- mevcut logistic regression yerine ML katmanini pasif veya shadow moda cekme

Bu MVP sonunda sistem:

- canli hard rule tanimlayabilecek
- eski instruction state sizintisini azaltacak
- retrieval'da gereksiz hard SQL filtrelerden kurtulacak
- neden bu stok secildi sorusuna daha iyi cevap verecek

### 22.2 Fazlara Gore Teknik Isler

#### Faz 1: Skorlama ve Veri Tabanini Hazirlama

Amaç:

- mevcut sistemi bozmadan yeni veri modelini yanda kurmak

Yapilacaklar:

1. yeni tablo: `canonical_stock_features`
2. yeni tablo: `matching_rule_sets`
3. yeni tablo: `matching_rules`
4. yeni tablo: `matching_rule_audit`
5. yeni tablo: `match_candidate_features`
6. mevcut `match_history`'ye `pipeline_version` ve `rule_summary_json` eklemek

Kod etkisi:

- [apps/sync-service/src/index.ts](C:/WebProject/RPA/Seykoc_RPA/stock-matching-platform/apps/sync-service/src/index.ts)
- [packages/common/src/extractors.ts](C:/WebProject/RPA/Seykoc_RPA/stock-matching-platform/packages/common/src/extractors.ts)
- yeni migration dosyalari

Teslim kriteri:

- sync sonrasi canonical alanlar doluyor olmali
- eski sistem bozulmadan calismaya devam etmeli

#### Faz 2: Core Scoring Refactor

Amaç:

- scorer reason string tabanindan structured score breakdown'a gecmek

Yapilacaklar:

1. `scoreCandidates` ciktisini genisletmek
2. canonical thickness ve canonical dims kavramini ayirmak
3. koddan ve isimden parse edilen kalinligi fallback sinyal yapmak
4. ayni thickness sinyalinin birden fazla kez puanlanmasini azaltmak
5. score breakdown JSON uretmek

Kod etkisi:

- [packages/common/src/scoring.ts](C:/WebProject/RPA/Seykoc_RPA/stock-matching-platform/packages/common/src/scoring.ts)
- [packages/common/src/types.ts](C:/WebProject/RPA/Seykoc_RPA/stock-matching-platform/packages/common/src/types.ts)

Teslim kriteri:

- her candidate icin structured score breakdown donmeli
- mevcut top-K davranisi buyuk capta bozulmamali

#### Faz 3: Retrieval Refactor

Amaç:

- recall'i artirmak, sessiz aday kaybini azaltmak

Yapilacaklar:

1. `series present` zorunlulugunu SQL'den kaldirmak
2. `strict/all_active/all_active_wide` asamalarini yeniden tanimlamak
3. canonical feature tablosundan aday cekmek
4. retrieval ile hard rule'u ayirmak

Kod etkisi:

- [apps/matching-api/src/index.ts](C:/WebProject/RPA/Seykoc_RPA/stock-matching-platform/apps/matching-api/src/index.ts)

Teslim kriteri:

- sema degisikliginde aday havuzu dramatik sekilde bosalmamali
- dogru stok daha sik top-50 aday havuzuna girmeli

#### Faz 4: Hard Rule Engine V1

Amaç:

- canli tanimlanan kesin kurallari deterministic sekilde uygulamak

Yapilacaklar:

1. rule evaluator modulu yazmak
2. `require_prefix`, `require_exact_series`, `require_non_null`, `reject_prefix`, `reject_if_missing_dimension` effectlerini eklemek
3. active rule set yukleme mekanizmasi eklemek
4. candidate bazinda pass/reject karari vermek
5. audit log yazmak

Kod etkisi:

- yeni dosya: `apps/matching-api/src/rule-engine.ts`
- yeni dosya: `apps/matching-api/src/rule-loader.ts`
- [apps/matching-api/src/index.ts](C:/WebProject/RPA/Seykoc_RPA/stock-matching-platform/apps/matching-api/src/index.ts)

Teslim kriteri:

- ornek kural `0-8 => ALV prefix` canli calisiyor olmali
- rule reject edilen aday response icinde nedeni ile gorunmeli

#### Faz 5: Soft Preference ve Session State Temizligi

Amaç:

- instruction bazli preference ile hard rule'u tamamen ayirmak

Yapilacaklar:

1. `activeMatchPolicy` yasam dongusunu netlestirmek
2. yeni instruction gelince eski ephemeral preference'i temizlemek
3. `sadece/yalnizca` ile `one al/tercih et` ifadelerini parser'da ayirmak
4. session preference ile kalici business rule'u ayirmak

Kod etkisi:

- [apps/matching-api/src/instruction-policies.ts](C:/WebProject/RPA/Seykoc_RPA/stock-matching-platform/apps/matching-api/src/instruction-policies.ts)
- [apps/matching-api/src/public/app.js](C:/WebProject/RPA/Seykoc_RPA/stock-matching-platform/apps/matching-api/src/public/app.js)

Teslim kriteri:

- eski chat instruction'lari sessizce sonraki analizlere sizmiyor olmali
- soft instruction sadece boost vermeli, hard filter olmamali

#### Faz 6: Audit ve Explainability

Amaç:

- sistemin kararini gorulebilir hale getirmek

Yapilacaklar:

1. response icine `rule_hits`, `rule_rejections`, `score_breakdown` eklemek
2. match history ile candidate feature snapshot kaydetmek
3. admin veya debug endpoint ile audit cekebilmek

Kod etkisi:

- [apps/matching-api/src/index.ts](C:/WebProject/RPA/Seykoc_RPA/stock-matching-platform/apps/matching-api/src/index.ts)
- yeni endpointler

Teslim kriteri:

- bir match icin hangi kural neden calisti gorulebilmeli

#### Faz 7: Learning Refactor

Amaç:

- gecmis secim boost'unu baglamsal hale getirmek

Yapilacaklar:

1. `series + dim_text` tabanli boost'u kaldirmak
2. yeni contextual boost key eklemek
3. boost ust limitini dusurmek
4. hard rule ile catisan boost'lari sifirlamak

Kod etkisi:

- [apps/matching-api/src/index.ts](C:/WebProject/RPA/Seykoc_RPA/stock-matching-platform/apps/matching-api/src/index.ts)
- yeni learning helper modulu

Teslim kriteri:

- ogrenme artik yanlis baglamda stok firlatmamali

#### Faz 8: Ranking Model Altyapisi

Amaç:

- `LightGBMRanker` icin veri uretim ve shadow inference hattini kurmak

Yapilacaklar:

1. `match_candidate_features` snapshot yazmak
2. Python training script eklemek
3. offline dataset export pipeline kurmak
4. shadow inference servisi eklemek
5. online sonucu degistirmeden model skoru loglamak

Kod etkisi:

- yeni klasor: `services/ranking-service`
- yeni scriptler: `scripts/export-ranking-dataset.*`
- [apps/matching-api/src/rerank.ts](C:/WebProject/RPA/Seykoc_RPA/stock-matching-platform/apps/matching-api/src/rerank.ts)

Teslim kriteri:

- model training dataseti cikabiliyor olmali
- shadow mode loglari alinabiliyor olmali

### 22.3 Dosya Bazli Refactor Sirasi

Ilk dokunulacak dosyalar:

1. [packages/common/src/types.ts](C:/WebProject/RPA/Seykoc_RPA/stock-matching-platform/packages/common/src/types.ts)
2. [packages/common/src/scoring.ts](C:/WebProject/RPA/Seykoc_RPA/stock-matching-platform/packages/common/src/scoring.ts)
3. [packages/common/src/extractors.ts](C:/WebProject/RPA/Seykoc_RPA/stock-matching-platform/packages/common/src/extractors.ts)
4. [apps/sync-service/src/index.ts](C:/WebProject/RPA/Seykoc_RPA/stock-matching-platform/apps/sync-service/src/index.ts)
5. [apps/matching-api/src/index.ts](C:/WebProject/RPA/Seykoc_RPA/stock-matching-platform/apps/matching-api/src/index.ts)
6. [apps/matching-api/src/instruction-policies.ts](C:/WebProject/RPA/Seykoc_RPA/stock-matching-platform/apps/matching-api/src/instruction-policies.ts)
7. [apps/matching-api/src/public/app.js](C:/WebProject/RPA/Seykoc_RPA/stock-matching-platform/apps/matching-api/src/public/app.js)
8. [apps/matching-api/src/rerank.ts](C:/WebProject/RPA/Seykoc_RPA/stock-matching-platform/apps/matching-api/src/rerank.ts)

### 22.4 Ilk Sprint Onerisi

Ilk sprintte su isi bitirmek en dogru adim olur:

- retrieval'dan `series present` zorlamasini kaldir
- score breakdown yapisini ekle
- hard rule engine v1'i ekle
- `0-8 => ALV prefix` gibi kurali tabloda calistir
- UI'da aktif hard rule ve rule reason gostermeye basla

Bu sprint sonundaki kazanım:

- sistem daha stabil olur
- canli rule gereksinimi cozulur
- sonraki ML gecisi icin saglam veri toplanir

### 22.5 Ilk Sprint Sonrasi

Ikinci sprint:

- session instruction temizligi
- contextual learning refactor
- rule admin CRUD

Ucuncu sprint:

- ranking dataset export
- LightGBM shadow mode
- offline benchmark

### 22.6 Baslangic Karari

Kodlamaya baslarken ilk teknik uygulama adimi olarak su paketi oneriyorum:

1. migrationlar
2. canonical feature modeli
3. scoring refactor
4. hard rule evaluator
5. `/match` pipeline entegrasyonu

Bu sira en dusuk riskli ve en yuksek getirili sira olur.
