# Kural Yönetimi Kullanıcı Rehberi

Bu doküman, `Kural Yönetimi` ekranındaki `Zorunlu Kurallar` ve `Tercih Talimatları` bölümlerini ilk kez kullanacak kişiler için hazırlanmıştır.

Bu ekranın amacı, stok eşleştirme sonuçlarını daha doğru hale getirmektir.

## 1. İki Bölümün Farkı

Sistemde iki farklı yönlendirme yöntemi vardır:

### Zorunlu Kurallar
Zorunlu kurallar, sistemin mutlaka uyması gereken kesin kurallardır.

Örnek:
- `Kalınlık 0 ile 8 arasındaysa stok kodu ALV ile başlamalı`
- `Alaşım serisi 7075 ise sadece 7075 serisindeki stoklar dikkate alınmalı`

Bu tür kurallar eşleştirmeyi sınırlar. Kuralı sağlamayan adaylar elenir.

### Tercih Talimatları
Tercih talimatları, sistemi yönlendirir ama zorlamaz.

Örnek:
- `APL ile başlayan stokları öne al`
- `7075 serisini tercih et`
- `ACB ile başlayan stoklarda ara`

Bu tür talimatlar adayları tamamen silmez. Sadece sıralamayı ve seçimi etkiler.

Kısa özet:
- `Zorunlu Kural`: Kesin kuraldır, eleme yapar.
- `Tercih Talimatı`: Yönlendirmedir, öncelik verir.

## 2. Hangi Durumda Hangisini Kullanmalıyım?

`Zorunlu Kurallar` kullanın:
- Kural her zaman geçerliyse
- Yanlış stok seçilmesini kesin olarak engellemek istiyorsanız
- Kurum içinde net bir iş kuralı varsa

`Tercih Talimatları` kullanın:
- Sonuçları biraz yönlendirmek istiyorsanız
- Kesin eleme istemiyorsanız
- Kullanıcı bazlı veya iş bazlı esnek tercih gerekiyorsa

Basit karar kuralı:
- `Bu kural her zaman geçerli` diyorsanız: `Zorunlu Kural`
- `Genelde böyle olsun ama gerekirse başka aday da seçilebilsin` diyorsanız: `Tercih Talimatı`

## 3. Zorunlu Kural Nasıl Eklenir?

`Kural Yönetimi > Zorunlu Kurallar` sekmesine girin.

Formdaki alanlar:

### Öncelik
Kuralların uygulanma sırasını belirler.

Genel yaklaşım:
- daha önemli kurala daha yüksek öncelik verin
- örneğin `100`, `200`, `300` gibi değerler kullanın

Not:
- Öncelik büyüdükçe kural daha güçlü görünmez
- sadece hangi sırayla değerlendirileceğini belirler

### Açıklama
Kuralın ne yaptığını herkesin anlayacağı kısa bir cümleyle yazın.

Örnek:
- `0-8 kalınlıkta ALV zorunlu`
- `7075 serisinde seri eşleşmesi zorunlu`

### Kontrol Edilecek Alan
Kuralın hangi bilgiye bakacağını belirler.

Seçenekler:
- `Kalınlık`
- `En`
- `Boy`
- `Alaşım Serisi`
- `Ürün Tipi`

Örnek:
- Kalınlığa göre kural kuracaksanız `Kalınlık`
- Seriye göre kural kuracaksanız `Alaşım Serisi`

### İlk uygun kuralda dur
Bu kutu işaretlenirse, sistem ilk eşleşen zorunlu kuraldan sonra devam etmez.

Ne zaman kullanılır:
- tek bir kesin kural yeterliyse
- aynı satır için başka zorunlu kuralın çalışmasını istemiyorsanız

Ne zaman kullanmayın:
- birden fazla zorunlu kural birlikte çalışsın istiyorsanız

### En Az / En Çok / Tam Eşit
Burada kuralın hangi değer aralığında geçerli olacağını tanımlarsınız.

Kullanım mantığı:
- `En Az`: alt sınır
- `En Çok`: üst sınır
- `Tam Eşit`: tam eşleşme

Örnek 1:
- `En Az = 0`
- `En Çok = 8`
Anlamı: `0 ile 8 arasındaki değerler`

Örnek 2:
- `Tam Eşit = 7075`
Anlamı: `yalnızca 7075 ise`

Not:
- Hepsini doldurmanız gerekmez
- İhtiyaca göre birini veya birkaçını kullanabilirsiniz

### Uygulanacak Kural
Sistem, koşul sağlandığında ne yapacağını burada öğrenir.

Seçenekler:
- `Stok kodu şu önek ile başlamalı`
- `Stok kodu şu önek ile başlamamalı`
- `Alaşım serisi tam eşleşmeli`
- `Seçilen alan boş olmamalı`
- `Ölçü bilgisi eksikse ele`

### Kural Değeri
Seçilen kurala göre girilmesi gereken değerdir.

Örnek:
- önek için `ALV`
- seri için `7075`

### Hedef Alan
Bazı kural tipleri belirli bir alan üzerinde çalışır.

Örnek hedef alanlar:
- `Stok Kodu`
- `Stok Adı`
- `Kalınlık`
- `En`
- `Boy`

Not:
- Her kural türünde doldurmanız gerekmez
- Sistem ihtiyaç olan durumda kullanır

### Kaydetme
Tüm alanları doldurduktan sonra `Zorunlu Kuralı Kaydet` butonuna basın.

Kural kaydedildiğinde:
- yeni eşleştirmelerde devreye girer
- kural listesinde görünür
- gerekirse aktif/pasif yapılabilir

## 4. Zorunlu Kural Örnekleri

### Örnek 1: Kalınlık aralığına göre stok kodu öneki
Amaç:
`0 ile 8 arasındaki kalınlıklarda yalnızca ALV ile başlayan stoklar seçilsin`

Form girişi:
- `Öncelik`: `100`
- `Açıklama`: `0-8 kalınlıkta ALV zorunlu`
- `Kontrol Edilecek Alan`: `Kalınlık`
- `En Az`: `0`
- `En Çok`: `8`
- `Uygulanacak Kural`: `Stok kodu şu önek ile başlamalı`
- `Kural Değeri`: `ALV`

### Örnek 2: Belirli seride tam seri eşleşmesi
Amaç:
`7075 isteniyorsa sistem başka serileri getirmesin`

Form girişi:
- `Öncelik`: `200`
- `Açıklama`: `7075 için seri eşleşmesi zorunlu`
- `Kontrol Edilecek Alan`: `Alaşım Serisi`
- `Tam Eşit`: `7075`
- `Uygulanacak Kural`: `Alaşım serisi tam eşleşmeli`
- `Kural Değeri`: `7075`

### Örnek 3: Eksik ölçü bilgisi varsa ele
Amaç:
`Ölçü eksik olan adaylar değerlendirmeye girmesin`

Form girişi:
- `Öncelik`: `150`
- `Açıklama`: `Ölçü eksikse ele`
- `Kontrol Edilecek Alan`: `Kalınlık`
- `Uygulanacak Kural`: `Ölçü bilgisi eksikse ele`
- `Hedef Alan`: `Kalınlık`

## 5. Tercih Talimatları Nasıl Çalışır?

`Tercih Talimatları` bölümü, sistemi doğal dil ile yönlendirmenizi sağlar.

Burada yazılan talimatlar:
- eşleşmeyi yeniden yorumlayabilir
- sıralamayı etkileyebilir
- sistemin bazı adayları öne almasını sağlayabilir

Ama unutmayın:
- bu bölüm zorunlu kural değildir
- kesin eleme yapmaz

## 6. Tercih Talimatı Örnekleri

Kullanabileceğiniz örnek ifadeler:
- `APL ile başlayan stokları öne al`
- `7075 serisini tercih et`
- `ACB ile başlayan stoklarda ara`
- `6000 serisinde ara`
- `2. satır kesim yok`
- `Tüm satırlarda menşei yerli olsun`

Beklenen davranış:
- sistem mevcut satırları yeniden değerlendirir
- gerekirse yeniden eşleştirme yapar
- uygun adayları daha yukarı taşır

## 7. Zorunlu Kural mı, Tercih Talimatı mı?

Bu tabloyu referans alın:

- `Her zaman geçerli bir iş kuralı`: `Zorunlu Kural`
- `Sadece yönlendirme veya tercih`: `Tercih Talimatı`
- `Yanlış aday kesin elensin`: `Zorunlu Kural`
- `Uygun adaylar arasında biri öne çıksın`: `Tercih Talimatı`

Örnek karşılaştırma:

Yanlış:
- `ALV olmalı gibi düşünüyorum` deyip bunu zorunlu kural yapmak

Daha doğru:
- Eğer her zaman geçerliyse `Zorunlu Kural`
- sadece çoğu durumda isteniyorsa `Tercih Talimatı`

## 8. Sık Yapılan Hatalar

### 1. Zorunlu kuralı gereksiz sert kullanmak
Her talimat zorunlu kural yapılmamalıdır.

Eğer gereğinden fazla zorunlu kural tanımlanırsa:
- aday havuzu daralır
- doğru stok gözden kaçabilir

### 2. Açıklama alanını boş bırakmak
Açıklama alanı kısa ama açık olmalıdır.

İyi örnek:
- `10 mm altı için ACB zorunlu`

Zayıf örnek:
- `test`

### 3. Öncelik değerlerini rastgele vermek
Öncelik düzenli kullanılmalıdır.

Öneri:
- `100` temel kurallar
- `200` daha özel kurallar
- `300` istisna kuralları

### 4. Tercih talimatından kesin sonuç beklemek
Tercih talimatı yardımcı olur ama zorlamaz.

Kesin davranış istiyorsanız zorunlu kural tanımlayın.

## 9. Önerilen Kullanım Sırası

Yeni başlayan kullanıcılar için önerilen sıra:

1. Önce sistemi normal haliyle kullanın.
2. Tekrarlayan hataları not alın.
3. Her zaman geçerli olanları `Zorunlu Kural` olarak ekleyin.
4. Esnek ihtiyaçları `Tercih Talimatı` ile yönetin.
5. Çok fazla kural eklemek yerine, az ve net kural tanımlayın.

## 10. Hızlı Başlangıç

İlk kuralınızı oluşturmak için:

1. `Kural Yönetimi` ekranını açın.
2. `Zorunlu Kurallar` sekmesinde kalın.
3. `Açıklama` alanına kuralı kısa şekilde yazın.
4. `Kontrol Edilecek Alan` seçin.
5. Gerekliyse `En Az`, `En Çok` veya `Tam Eşit` girin.
6. `Uygulanacak Kural` seçin.
7. Gerekli ise `Kural Değeri` girin.
8. `Zorunlu Kuralı Kaydet` butonuna basın.

İlk tercih talimatınızı vermek için:

1. `Tercih Talimatları` sekmesine gidin.
2. Talimatı normal cümleyle yazın.
3. Önizlemeyi kontrol edin.
4. Sonucu beğeniyorsanız kullanmaya devam edin.

## 11. Son Tavsiye

En iyi sonuç için şu yaklaşımı kullanın:

- az sayıda ama net zorunlu kural tanımlayın
- geri kalan ihtiyaçları tercih talimatı ile yönetin
- aynı ihtiyacı hem zorunlu kural hem tercih talimatı olarak tanımlamayın

Temel prensip:
- `Kesin ise kural`
- `Esnek ise tercih`
